import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { newId } from "../lib/ids";
import { MINUTE } from "../lib/time";
import { describeError } from "../observability/logger";
import { type TemplateContext, type TemplateName, templates } from "./templates";
import { EmailSendError, getEmailTransport } from "./transport";

type TemplateData = { [K in TemplateName]: Parameters<(typeof templates)[K]>[1] };

export interface OutboundEmail<K extends TemplateName = TemplateName> {
  template: K;
  to: string;
  data: TemplateData[K];
  replyTo?: string | null;
  related?: { type: string; id: string };
  /** Unique per logical email (e.g. `enquiry:<id>:team`) so retries never duplicate it. */
  idempotencyKey?: string;
}

export const MAX_ATTEMPTS = 6;
const BACKOFF = [1, 5, 15, 60, 360].map((m) => m * MINUTE);

export function backoffFor(attempts: number): number {
  return BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] ?? 360 * MINUTE;
}

function templateContext(ctx: ServerContext): TemplateContext {
  return { appName: ctx.config.appName, origin: ctx.config.origin };
}

function render<K extends TemplateName>(ctx: ServerContext, template: K, data: TemplateData[K]) {
  const fn = templates[template] as (
    t: TemplateContext,
    d: TemplateData[K],
  ) => ReturnType<(typeof templates)[K]>;
  return fn(templateContext(ctx), data);
}

/**
 * Sends a SENSITIVE email (sign-in codes, reset and invitation links) immediately, inside the
 * request, so the user gets real feedback. The outbox keeps only redacted metadata — the code or
 * link itself is never stored or logged.
 */
export async function sendSensitive<K extends TemplateName>(
  ctx: ServerContext,
  email: OutboundEmail<K>,
): Promise<{ ok: boolean }> {
  const rendered = render(ctx, email.template, email.data);
  const transport = getEmailTransport(ctx.config, ctx.env);
  const id = newId("email", ctx.clock.now());
  let providerId: string | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await transport.send({
        to: email.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: email.replyTo ?? ctx.config.email.replyTo,
        idempotencyKey: id,
        tags: [{ name: "template", value: email.template }],
      });
      providerId = result.id;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      ctx.log.error("email_send_failed", {
        template: email.template,
        attempt,
        transport: transport.name,
        ...describeError(error),
      });
      if (!(error instanceof EmailSendError && error.retryable)) break;
    }
  }

  const now = ctx.clock.now();
  await ctx.db.insert(schema.emailOutbox).values({
    id,
    template: email.template,
    toEmail: email.to,
    subject: email.template === "loginCode" ? "Sign-in code" : rendered.subject,
    payload: { redacted: true },
    sensitive: true,
    status: providerId ? "sent" : "dead",
    attempts: 1,
    nextAttemptAt: null,
    lastError,
    providerMessageId: providerId,
    idempotencyKey: email.idempotencyKey ?? id,
    relatedType: email.related?.type ?? null,
    relatedId: email.related?.id ?? null,
    createdAt: now,
    updatedAt: now,
    sentAt: providerId ? now : null,
  });
  return { ok: Boolean(providerId) };
}

/**
 * Queues an ordinary email in the outbox and starts delivery after the response is sent.
 * If delivery fails, the cron job retries with backoff; nothing is silently dropped.
 */
export async function enqueueEmail<K extends TemplateName>(
  ctx: ServerContext,
  email: OutboundEmail<K>,
): Promise<string> {
  const now = ctx.clock.now();
  const id = newId("email", now);
  const rendered = render(ctx, email.template, email.data); // fail fast on template errors
  const inserted = await ctx.db
    .insert(schema.emailOutbox)
    .values({
      id,
      template: email.template,
      toEmail: email.to,
      subject: rendered.subject,
      payload: { data: email.data as unknown, replyTo: email.replyTo ?? null } as Record<
        string,
        unknown
      >,
      sensitive: false,
      status: "queued",
      attempts: 0,
      nextAttemptAt: now,
      idempotencyKey: email.idempotencyKey ?? id,
      relatedType: email.related?.type ?? null,
      relatedId: email.related?.id ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.emailOutbox.idempotencyKey })
    .returning({ id: schema.emailOutbox.id });
  if (inserted.length === 0) {
    ctx.log.info("email_duplicate_suppressed", { template: email.template });
    return id;
  }
  ctx.waitUntil(
    deliverQueued(ctx, id).catch((error) =>
      ctx.log.error("email_delivery_crashed", describeError(error)),
    ),
  );
  return id;
}

/** Claims and delivers one queued/failed email. Safe to call concurrently (atomic claim). */
export async function deliverQueued(
  ctx: ServerContext,
  id: string,
): Promise<"sent" | "failed" | "dead" | "skipped"> {
  const now = ctx.clock.now();
  const claimed = await ctx.db
    .update(schema.emailOutbox)
    .set({ status: "sending", attempts: sql`${schema.emailOutbox.attempts} + 1`, updatedAt: now })
    .where(
      and(
        eq(schema.emailOutbox.id, id),
        eq(schema.emailOutbox.sensitive, false),
        inArray(schema.emailOutbox.status, ["queued", "failed"]),
        or(isNull(schema.emailOutbox.nextAttemptAt), lte(schema.emailOutbox.nextAttemptAt, now)),
      ),
    )
    .returning();
  const row = claimed[0];
  if (!row) return "skipped";

  const payload = row.payload as { data?: unknown; replyTo?: string | null };
  const transport = getEmailTransport(ctx.config, ctx.env);
  try {
    const rendered = render(ctx, row.template as TemplateName, payload.data as never);
    const result = await transport.send({
      to: row.toEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: payload.replyTo ?? ctx.config.email.replyTo,
      idempotencyKey: row.idempotencyKey,
      tags: [{ name: "template", value: row.template }],
    });
    await ctx.db
      .update(schema.emailOutbox)
      .set({
        status: "sent",
        providerMessageId: result.id,
        sentAt: ctx.clock.now(),
        updatedAt: ctx.clock.now(),
        lastError: null,
      })
      .where(eq(schema.emailOutbox.id, id));
    ctx.log.info("email_sent", {
      template: row.template,
      transport: transport.name,
      attempts: row.attempts,
    });
    return "sent";
  } catch (error) {
    const retryable = !(error instanceof EmailSendError) || error.retryable;
    const dead = !retryable || row.attempts >= MAX_ATTEMPTS;
    await ctx.db
      .update(schema.emailOutbox)
      .set({
        status: dead ? "dead" : "failed",
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        nextAttemptAt: dead ? null : ctx.clock.now() + backoffFor(row.attempts),
        updatedAt: ctx.clock.now(),
      })
      .where(eq(schema.emailOutbox.id, id));
    ctx.log.error(dead ? "email_dead" : "email_retry_scheduled", {
      template: row.template,
      attempts: row.attempts,
      transport: transport.name,
      ...describeError(error),
    });
    return dead ? "dead" : "failed";
  }
}

/** Cron: recovers stuck sends and delivers everything that is due. */
export async function deliverDue(ctx: ServerContext, limit = 25): Promise<Record<string, number>> {
  const now = ctx.clock.now();
  await ctx.db
    .update(schema.emailOutbox)
    .set({ status: "failed", nextAttemptAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.emailOutbox.status, "sending"),
        lte(schema.emailOutbox.updatedAt, now - 10 * MINUTE),
      ),
    );

  const due = await ctx.db
    .select({ id: schema.emailOutbox.id })
    .from(schema.emailOutbox)
    .where(
      and(
        eq(schema.emailOutbox.sensitive, false),
        inArray(schema.emailOutbox.status, ["queued", "failed"]),
        lte(schema.emailOutbox.nextAttemptAt, now),
      ),
    )
    .orderBy(schema.emailOutbox.nextAttemptAt)
    .limit(limit)
    .all();

  const counts: Record<string, number> = { sent: 0, failed: 0, dead: 0, skipped: 0 };
  for (const { id } of due) {
    const outcome = await deliverQueued(ctx, id);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  return counts;
}
