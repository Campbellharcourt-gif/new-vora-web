import { SECURITY_SEVERITIES } from "@shared/enums";
import { and, count, desc, eq, gt, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId } from "../lib/ids";
import { HOUR } from "../lib/time";
import { writeAudit } from "../observability/audit";
import { getSetting } from "./settings";

/**
 * Admin workspace read models: the dashboard overview, integration status, and the security
 * views. Every function authorises the actor itself; dashboard modules the actor can't see come
 * back as null rather than zero.
 */

export async function adminOverview(ctx: ServerContext, actorInput: Actor | null) {
  const actor = await authorize(ctx, actorInput, "admin.access");
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const day = ctx.clock.now() - 24 * HOUR;
  const week = ctx.clock.now() - 7 * 24 * HOUR;
  const n = (row: { n: number } | undefined) => Number(row?.n ?? 0);
  const [clients, activeProjects, users, newUsers, securityHigh] = await Promise.all([
    has("clients.view")
      ? ctx.db
          .select({ n: count() })
          .from(schema.clientOrgs)
          .where(eq(schema.clientOrgs.status, "active"))
          .get()
          .then(n)
      : null,
    has("engagements.view") && actor.rank >= 60
      ? ctx.db
          .select({ n: count() })
          .from(schema.engagements)
          .where(inArray(schema.engagements.status, ["planning", "in_progress", "review"]))
          .get()
          .then(n)
      : null,
    has("users.view")
      ? ctx.db
          .select({ n: count() })
          .from(schema.users)
          .where(and(isNull(schema.users.deletedAt), eq(schema.users.status, "active")))
          .get()
          .then(n)
      : null,
    has("users.view")
      ? ctx.db
          .select({ n: count() })
          .from(schema.users)
          .where(and(isNull(schema.users.deletedAt), gt(schema.users.createdAt, week)))
          .get()
          .then(n)
      : null,
    has("security.view")
      ? ctx.db
          .select({ n: count() })
          .from(schema.securityEvents)
          .where(
            and(
              inArray(schema.securityEvents.severity, ["high", "critical"]),
              gt(schema.securityEvents.createdAt, day),
            ),
          )
          .get()
          .then(n)
      : null,
  ]);
  return {
    counts: { clients, activeProjects, users, newUsers7d: newUsers, securityHigh24h: securityHigh },
  };
}

/** The most recent sign-ups and invitations accepted (dashboard). */
export async function recentUsers(ctx: ServerContext, actorInput: Actor | null, limit = 6) {
  await authorize(ctx, actorInput, "users.view");
  return ctx.db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      createdAt: schema.users.createdAt,
      roles: sql<string>`coalesce((select group_concat(${schema.roles.name}, ', ') from ${schema.userRoles} join ${schema.roles} on ${schema.roles.id} = ${schema.userRoles.roleId} where ${schema.userRoles.userId} = ${schema.users.id}), '')`,
    })
    .from(schema.users)
    .where(isNull(schema.users.deletedAt))
    .orderBy(desc(schema.users.createdAt))
    .limit(limit)
    .all();
}

export type IntegrationState = "configured" | "not_configured" | "development";

/**
 * Which integrations are configured — presence only. Values (keys, secrets) are never read into
 * the response; they live in the environment, not in editable settings.
 */
export async function integrationStatus(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "settings.view");
  const { config } = ctx;
  const ai = await getSetting(ctx, "ai.config");
  const items: { name: string; state: IntegrationState; detail: string; env: string[] }[] = [
    {
      name: "Email delivery",
      state:
        config.email.transport === "resend"
          ? "configured"
          : config.email.transport === "capture"
            ? "development"
            : "not_configured",
      detail:
        config.email.transport === "resend"
          ? `Sending through Resend as ${config.email.from}.`
          : config.email.transport === "capture"
            ? "Development capture: emails are kept locally, not sent."
            : "Email is switched off: nothing is sent.",
      env: ["EMAIL_TRANSPORT", "EMAIL_FROM", "RESEND_API_KEY"],
    },
    {
      name: "Email delivery webhooks",
      state: config.email.resendWebhookSecret ? "configured" : "not_configured",
      detail: config.email.resendWebhookSecret
        ? "Bounce and delivery updates are verified."
        : "Delivery updates aren't received.",
      env: ["RESEND_WEBHOOK_SECRET"],
    },
    {
      name: "Bot protection (Turnstile)",
      state:
        config.turnstile.secretKey && config.turnstile.siteKey ? "configured" : "not_configured",
      detail:
        config.turnstile.secretKey && config.turnstile.siteKey
          ? "Forms are checked with Turnstile."
          : config.isProductionLike
            ? "Not configured: forms that require it will refuse submissions."
            : "Not configured: skipped outside staging and production.",
      env: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
    },
    {
      name: "VORA AI (Gemini)",
      state: config.ai.geminiApiKey ? "configured" : "not_configured",
      detail: config.ai.geminiApiKey
        ? `Key present. Admin tools ${ai.adminEnabled ? "on" : "off"}, public assistant ${ai.publicEnabled ? "on" : "off"} (model ${ai.model}).`
        : "No API key: AI features stay off and say so.",
      env: ["GEMINI_API_KEY", "AI_GATEWAY_BASE_URL"],
    },
  ];
  return items;
}

// --- Security --------------------------------------------------------------------------------------

export interface SecurityEventFilter {
  severity?: string;
  type?: string;
  userId?: string;
  before?: number;
}

export async function listSecurityEvents(
  ctx: ServerContext,
  actorInput: Actor | null,
  filter: SecurityEventFilter = {},
) {
  await authorize(ctx, actorInput, "security.view");
  const where: SQL[] = [];
  if (SECURITY_SEVERITIES.includes(filter.severity as never)) {
    where.push(eq(schema.securityEvents.severity, filter.severity as never));
  }
  if (filter.type && /^[a-z_.]{1,60}$/.test(filter.type)) {
    where.push(sql`${schema.securityEvents.type} like ${`${filter.type}%`}`);
  }
  if (filter.userId && isId(filter.userId, "user")) {
    where.push(eq(schema.securityEvents.userId, filter.userId));
  }
  if (filter.before) where.push(lt(schema.securityEvents.createdAt, filter.before));
  const limit = 100;
  const rows = await ctx.db
    .select({
      id: schema.securityEvents.id,
      type: schema.securityEvents.type,
      severity: schema.securityEvents.severity,
      userId: schema.securityEvents.userId,
      userName: schema.users.name,
      country: schema.securityEvents.country,
      details: schema.securityEvents.details,
      createdAt: schema.securityEvents.createdAt,
      ackedAt: schema.securityEventAcks.createdAt,
    })
    .from(schema.securityEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.securityEvents.userId))
    .leftJoin(
      schema.securityEventAcks,
      eq(schema.securityEventAcks.eventId, schema.securityEvents.id),
    )
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(schema.securityEvents.createdAt))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  return {
    items,
    nextBefore: rows.length > limit ? (items.at(-1)?.createdAt ?? null) : null,
  };
}

export async function acknowledgeSecurityEvent(
  ctx: ServerContext,
  actorInput: Actor | null,
  eventId: string,
  note: string,
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "security.manage");
  if (!isId(eventId, "securityEvent")) throw errors.notFound();
  const event = await ctx.db
    .select({ id: schema.securityEvents.id, type: schema.securityEvents.type })
    .from(schema.securityEvents)
    .where(eq(schema.securityEvents.id, eventId))
    .get();
  if (!event) throw errors.notFound();
  await ctx.db
    .insert(schema.securityEventAcks)
    .values({
      eventId,
      userId: actor.userId,
      note: note.trim().slice(0, 500) || null,
      createdAt: ctx.clock.now(),
    })
    .onConflictDoNothing();
  await writeAudit(ctx, actor, {
    action: "security.event.ack",
    targetType: "security_event",
    targetId: eventId,
    summary: `Acknowledged ${event.type}`,
  });
}

const FAILED_OUTCOMES = [
  "bad_credentials",
  "locked",
  "suspended",
  "mfa_failed",
  "rate_limited",
  "challenge_failed",
] as const;

/** Sign-in activity: recent attempts with the outcome, risk score and rough location. */
export async function loginActivity(
  ctx: ServerContext,
  actorInput: Actor | null,
  filter: { failuresOnly?: boolean; userId?: string } = {},
) {
  await authorize(ctx, actorInput, "security.view");
  const where: SQL[] = [];
  if (filter.failuresOnly) where.push(inArray(schema.loginAttempts.outcome, [...FAILED_OUTCOMES]));
  if (filter.userId && isId(filter.userId, "user")) {
    where.push(eq(schema.loginAttempts.userId, filter.userId));
  }
  const rows = await ctx.db
    .select({
      id: schema.loginAttempts.id,
      userId: schema.loginAttempts.userId,
      userName: schema.users.name,
      outcome: schema.loginAttempts.outcome,
      riskScore: schema.loginAttempts.riskScore,
      country: schema.loginAttempts.country,
      city: schema.loginAttempts.city,
      createdAt: schema.loginAttempts.createdAt,
    })
    .from(schema.loginAttempts)
    .leftJoin(schema.users, eq(schema.users.id, schema.loginAttempts.userId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(schema.loginAttempts.createdAt))
    .limit(100)
    .all();
  return rows.map((r) => ({
    ...r,
    failed: (FAILED_OUTCOMES as readonly string[]).includes(r.outcome),
  }));
}

/** Failed sign-ins in the last 24 hours (dashboard / security summary). */
export async function failedSignInsLastDay(ctx: ServerContext): Promise<number> {
  const row = await ctx.db
    .select({ n: count() })
    .from(schema.loginAttempts)
    .where(
      and(
        inArray(schema.loginAttempts.outcome, [...FAILED_OUTCOMES]),
        gt(schema.loginAttempts.createdAt, ctx.clock.now() - 24 * HOUR),
      ),
    )
    .get();
  return Number(row?.n ?? 0);
}
