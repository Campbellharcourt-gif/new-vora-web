import { ENQUIRY_PROJECT_TYPES, ENQUIRY_TRANSITIONS, type EnquiryStatus } from "@shared/enums";
import { fieldErrors } from "@shared/validation/common";
import { createEnquirySchema, type EnquiryFields } from "@shared/validation/enquiry";
import { and, count, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { enqueueEmail } from "../email/outbox";
import { randomCrockford } from "../lib/crypto";
import { AppError, errors } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { HOUR } from "../lib/time";
import { hashIp, writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";
import { issueFormToken, verifyFormToken } from "./form-token";
import { checkRateLimit } from "./rate-limit";
import { getSetting } from "./settings";
import { verifyTurnstile } from "./turnstile";

export const ENQUIRY_FORM = "enquiry";
const PER_EMAIL_PER_HOUR = 3;

export async function getEnquiryFormConfig(ctx: ServerContext) {
  const options = await getSetting(ctx, "enquiry.options");
  return {
    projectTypes: ENQUIRY_PROJECT_TYPES,
    budgets: options.budgets,
    timelines: options.timelines,
    sources: options.sources,
    turnstileSiteKey: ctx.config.turnstile.siteKey,
    formToken: await issueFormToken(ctx, ENQUIRY_FORM),
  };
}

export interface EnquirySubmission {
  fields: Record<string, unknown>;
  formToken: unknown;
  /** Hidden field humans never fill in. */
  honeypot?: string | null;
  turnstileToken?: string | null;
}

export type EnquiryOutcome =
  | { kind: "accepted"; reference: string; duplicate: boolean }
  /** Bot-shaped submission: the caller shows the normal success screen but nothing is stored. */
  | { kind: "discarded" };

/** Very small, explainable spam heuristic. Stored for triage; never auto-deletes anything. */
export function spamScore(fields: Pick<EnquiryFields, "message" | "name">): number {
  let score = 0;
  const links = (fields.message.match(/https?:\/\//gi) ?? []).length;
  if (links > 2) score += Math.min(40, links * 10);
  if (/(.)\1{9,}/.test(fields.message)) score += 20;
  if (/\b(crypto|casino|viagra|backlinks?|seo services)\b/i.test(fields.message)) score += 30;
  if (/https?:\/\//i.test(fields.name)) score += 30;
  return Math.min(100, score);
}

function newReference(): string {
  return `VR-${randomCrockford(6)}`;
}

/**
 * Public enquiry pipeline: rate limit → honeypot → signed form token (age + integrity) →
 * Turnstile → validation against configured options → per-email limit → idempotent persist →
 * team notification + confirmation via the retried outbox. The enquiry is stored before any email
 * is attempted, so an email outage never loses an enquiry.
 */
export async function submitEnquiry(
  ctx: ServerContext,
  input: EnquirySubmission,
): Promise<EnquiryOutcome> {
  if (!(await checkRateLimit(ctx, "RL_FORMS", "enquiry"))) throw errors.rateLimited(60);

  if (input.honeypot && input.honeypot.trim() !== "") {
    await recordSecurityEvent(ctx, {
      type: "spam.detected",
      severity: "info",
      details: { form: ENQUIRY_FORM, signal: "honeypot" },
    });
    return { kind: "discarded" };
  }

  const token = await verifyFormToken(ctx, ENQUIRY_FORM, input.formToken);
  if (!token.ok) {
    if (token.reason === "too_fast") {
      await recordSecurityEvent(ctx, {
        type: "spam.detected",
        severity: "info",
        details: { form: ENQUIRY_FORM, signal: "too_fast" },
      });
      return { kind: "discarded" };
    }
    throw errors.validation(
      { _form: "This form has expired. Please reload the page and try again." },
      "This form has expired. Please reload the page and try again.",
    );
  }

  const turnstile = await verifyTurnstile(ctx, input.turnstileToken, ENQUIRY_FORM);
  if (!turnstile.ok) {
    throw errors.validation(
      { _form: "We couldn't verify this submission. Please complete the check and try again." },
      "We couldn't verify this submission.",
    );
  }

  const options = await getSetting(ctx, "enquiry.options");
  const parsed = createEnquirySchema(options).safeParse(input.fields);
  if (!parsed.success) throw errors.validation(fieldErrors(parsed.error));
  const fields = parsed.data;

  // Idempotency: the same rendered form submitted twice returns the original reference.
  const existing = await ctx.db
    .select({ reference: schema.enquiries.reference })
    .from(schema.enquiries)
    .where(eq(schema.enquiries.submissionKey, token.nonce))
    .get();
  if (existing) return { kind: "accepted", reference: existing.reference, duplicate: true };

  const now = ctx.clock.now();
  const recentForEmail = await ctx.db
    .select({ n: count() })
    .from(schema.enquiries)
    .where(
      and(eq(schema.enquiries.email, fields.email), gt(schema.enquiries.createdAt, now - HOUR)),
    )
    .get();
  if ((recentForEmail?.n ?? 0) >= PER_EMAIL_PER_HOUR) throw errors.rateLimited(15 * 60);

  const retention = await getSetting(ctx, "retention");
  const label = (list: readonly { key: string; label: string }[], key?: string) =>
    key ? (list.find((o) => o.key === key)?.label ?? null) : null;
  const id = newId("enquiry", now);
  const score = spamScore(fields);
  const ipHash = await hashIp(ctx);

  let reference = newReference();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await ctx.db.batch([
        ctx.db.insert(schema.enquiries).values({
          id,
          reference,
          submissionKey: token.nonce,
          name: fields.name,
          email: fields.email,
          company: fields.company ?? null,
          websiteUrl: fields.website ?? null,
          projectTypes: fields.projectTypes,
          budgetKey: fields.budget ?? null,
          budgetLabel: label(options.budgets, fields.budget),
          timelineKey: fields.timeline,
          timelineLabel: label(options.timelines, fields.timeline) ?? fields.timeline,
          timelineDate: fields.timeline === "specific_date" ? (fields.timelineDate ?? null) : null,
          message: fields.message,
          sourceKey: fields.source ?? null,
          sourceLabel: label(options.sources, fields.source),
          sourceDetail: fields.sourceDetail ?? null,
          status: "received",
          spamScore: score,
          turnstileOk: turnstile.reason !== "skipped",
          consentAt: now,
          ipHash,
          country: ctx.meta.country,
          userAgent: ctx.meta.userAgent.slice(0, 256),
          retentionUntil: now + retention.enquiryMonths * 30 * 24 * HOUR,
          createdAt: now,
          updatedAt: now,
        }),
        ctx.db.insert(schema.enquiryEvents).values({
          id: newId("enquiryEvent", now),
          enquiryId: id,
          type: "received",
          toStatus: "received",
          createdAt: now,
        }),
      ]);
      break;
    } catch (error) {
      const message = String(error);
      if (
        message.includes("enquiries.submission_key") ||
        message.includes("enquiries_submission_uq")
      ) {
        const again = await ctx.db
          .select({ reference: schema.enquiries.reference })
          .from(schema.enquiries)
          .where(eq(schema.enquiries.submissionKey, token.nonce))
          .get();
        if (again) return { kind: "accepted", reference: again.reference, duplicate: true };
      }
      if (attempt === 2 || !message.includes("reference")) throw error;
      reference = newReference();
    }
  }

  const typeLabels = fields.projectTypes
    .map((key) => ENQUIRY_PROJECT_TYPES.find((t) => t.key === key)?.label ?? key)
    .join(", ");
  const emails = await getSetting(ctx, "contact.emails");
  await enqueueEmail(ctx, {
    template: "enquiryNotification",
    to: ctx.config.email.teamNotify,
    replyTo: fields.email,
    idempotencyKey: `enquiry:${id}:team`,
    related: { type: "enquiry", id },
    data: {
      reference,
      name: fields.name,
      email: fields.email,
      company: fields.company ?? null,
      website: fields.website ?? null,
      projectTypes: typeLabels,
      budget: label(options.budgets, fields.budget),
      timeline:
        fields.timeline === "specific_date" && fields.timelineDate
          ? `By ${fields.timelineDate}`
          : (label(options.timelines, fields.timeline) ?? fields.timeline),
      source:
        [label(options.sources, fields.source), fields.sourceDetail].filter(Boolean).join(" — ") ||
        null,
      message: fields.message,
      adminUrl: `${ctx.config.origin}/admin/enquiries/${id}`,
      spamScore: score,
    },
  });
  if (score < 50) {
    await enqueueEmail(ctx, {
      template: "enquiryConfirmation",
      to: fields.email,
      replyTo: emails.projects,
      idempotencyKey: `enquiry:${id}:confirmation`,
      related: { type: "enquiry", id },
      data: { name: fields.name, reference, replyEmail: emails.projects },
    });
  }
  ctx.log.info("enquiry_received", { enquiryId: id, spamScore: score });
  return { kind: "accepted", reference, duplicate: false };
}

// ---------------------------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------------------------

export async function listEnquiries(
  ctx: ServerContext,
  actorInput: Actor | null,
  filter: { status?: EnquiryStatus; before?: number; limit?: number } = {},
) {
  await authorize(ctx, actorInput, "enquiries.view");
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
  const conditions = [isNull(schema.enquiries.deletedAt)];
  if (filter.status) conditions.push(eq(schema.enquiries.status, filter.status));
  if (filter.before) conditions.push(lt(schema.enquiries.createdAt, filter.before));
  const rows = await ctx.db
    .select({
      id: schema.enquiries.id,
      reference: schema.enquiries.reference,
      name: schema.enquiries.name,
      email: schema.enquiries.email,
      company: schema.enquiries.company,
      projectTypes: schema.enquiries.projectTypes,
      status: schema.enquiries.status,
      spamScore: schema.enquiries.spamScore,
      createdAt: schema.enquiries.createdAt,
    })
    .from(schema.enquiries)
    .where(and(...conditions))
    .orderBy(desc(schema.enquiries.createdAt))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextBefore: hasMore ? (items.at(-1)?.createdAt ?? null) : null };
}

export async function getEnquiry(ctx: ServerContext, actorInput: Actor | null, id: string) {
  await authorize(ctx, actorInput, "enquiries.view");
  if (!isId(id, "enquiry")) throw errors.notFound();
  const enquiry = await ctx.db
    .select()
    .from(schema.enquiries)
    .where(and(eq(schema.enquiries.id, id), isNull(schema.enquiries.deletedAt)))
    .get();
  if (!enquiry) throw errors.notFound();
  const events = await ctx.db
    .select()
    .from(schema.enquiryEvents)
    .where(eq(schema.enquiryEvents.enquiryId, id))
    .orderBy(desc(schema.enquiryEvents.createdAt))
    .all();
  return { enquiry, events };
}

export async function changeEnquiryStatus(
  ctx: ServerContext,
  actorInput: Actor | null,
  id: string,
  to: EnquiryStatus,
  note?: string,
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "enquiries.edit");
  const { enquiry } = await getEnquiry(ctx, actor, id);
  if (!ENQUIRY_TRANSITIONS[enquiry.status].includes(to)) {
    throw new AppError("conflict", {
      message: `An enquiry can't move from ${enquiry.status} to ${to}.`,
    });
  }
  const now = ctx.clock.now();
  const closing = to === "won" || to === "lost" || to === "archived";
  const updated = await ctx.db
    .update(schema.enquiries)
    .set({
      status: to,
      updatedAt: now,
      closedAt: closing ? now : null,
      firstResponseAt: enquiry.firstResponseAt ?? (to === "contacted" ? now : null),
    })
    // Optimistic concurrency: only move from the status we validated against.
    .where(and(eq(schema.enquiries.id, id), eq(schema.enquiries.status, enquiry.status)))
    .returning({ id: schema.enquiries.id });
  if (updated.length === 0)
    throw errors.conflict("This enquiry was updated by someone else. Refresh and try again.");
  await ctx.db.insert(schema.enquiryEvents).values({
    id: newId("enquiryEvent", now),
    enquiryId: id,
    type: "status_change",
    fromStatus: enquiry.status,
    toStatus: to,
    body: note?.slice(0, 2000) ?? null,
    actorUserId: actor.userId,
    createdAt: now,
  });
  await writeAudit(ctx, actor, {
    action: "enquiry.status",
    targetType: "enquiry",
    targetId: id,
    summary: `Enquiry ${enquiry.reference}: ${enquiry.status} → ${to}`,
    changes: { status: { from: enquiry.status, to } },
  });
}

export async function addEnquiryNote(
  ctx: ServerContext,
  actorInput: Actor | null,
  id: string,
  body: string,
) {
  const actor = await authorize(ctx, actorInput, "enquiries.edit");
  await getEnquiry(ctx, actor, id);
  const text = body.trim();
  if (text.length < 1 || text.length > 2000)
    throw errors.validation({ note: "Notes must be 1–2000 characters." });
  await ctx.db.insert(schema.enquiryEvents).values({
    id: newId("enquiryEvent", ctx.clock.now()),
    enquiryId: id,
    type: "note",
    body: text,
    actorUserId: actor.userId,
    createdAt: ctx.clock.now(),
  });
}

export async function enquiryCounts(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "enquiries.view");
  const rows = await ctx.db
    .select({ status: schema.enquiries.status, n: count() })
    .from(schema.enquiries)
    .where(isNull(schema.enquiries.deletedAt))
    .groupBy(schema.enquiries.status)
    .all();
  const recent = await ctx.db
    .select({ n: count() })
    .from(schema.enquiries)
    .where(
      and(
        isNull(schema.enquiries.deletedAt),
        gt(schema.enquiries.createdAt, ctx.clock.now() - 7 * 24 * HOUR),
      ),
    )
    .get();
  return {
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
    last7Days: recent?.n ?? 0,
  };
}
