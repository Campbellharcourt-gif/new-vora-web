import type { LoginOutcome } from "@shared/enums";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { newId } from "../lib/ids";
import { DAY, HOUR, MINUTE } from "../lib/time";
import { hashIp } from "../observability/audit";
import type { LoginHistory } from "./risk";

/**
 * Account throttling (per user / email HMAC) and credential-stuffing protection (per IP hash):
 * - ≥ challengeAfter failures in `window` → Turnstile required,
 * - ≥ lockAfter failures in `window` → account locked for `lockDuration`,
 * - ≥ ipBlockAccounts distinct accounts failing from one IP hash within `ipBlockDuration` →
 *   that IP hash is refused sign-in until the window passes.
 */
export const THROTTLE_POLICY = {
  window: 15 * MINUTE,
  challengeAfter: 5,
  lockAfter: 10,
  lockDuration: 15 * MINUTE,
  ipBlockAccounts: 8,
  ipBlockDuration: HOUR,
} as const;

const FAILURE_OUTCOMES: LoginOutcome[] = ["bad_credentials", "mfa_failed"];

export async function recordLoginAttempt(
  ctx: ServerContext,
  input: {
    userId: string | null;
    emailHmac: string | null;
    outcome: LoginOutcome;
    riskScore?: number;
    riskReasons?: string[];
    deviceHash?: string | null;
  },
): Promise<void> {
  await ctx.db.insert(schema.loginAttempts).values({
    id: newId("loginAttempt", ctx.clock.now()),
    userId: input.userId,
    emailHmac: input.emailHmac,
    outcome: input.outcome,
    riskScore: Math.max(0, Math.min(100, input.riskScore ?? 0)),
    riskReasons: input.riskReasons ?? null,
    ipHash: await hashIp(ctx),
    ipPrefix: ctx.meta.ipPrefix,
    country: ctx.meta.country,
    city: ctx.meta.city,
    asn: ctx.meta.asn,
    userAgent: ctx.meta.userAgent.slice(0, 256),
    deviceHash: input.deviceHash ?? null,
    createdAt: ctx.clock.now(),
  });
}

/** Failures within the throttle window, keyed by user ID when known, otherwise by email HMAC. */
export async function recentFailures(
  ctx: ServerContext,
  subject: { userId: string | null; emailHmac: string },
): Promise<number> {
  const since = ctx.clock.now() - THROTTLE_POLICY.window;
  const who = subject.userId
    ? or(
        eq(schema.loginAttempts.userId, subject.userId),
        eq(schema.loginAttempts.emailHmac, subject.emailHmac),
      )
    : eq(schema.loginAttempts.emailHmac, subject.emailHmac);
  const row = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(schema.loginAttempts)
    .where(
      and(
        who,
        inArray(schema.loginAttempts.outcome, FAILURE_OUTCOMES),
        gt(schema.loginAttempts.createdAt, since),
      ),
    )
    .get();
  return Number(row?.count ?? 0);
}

/**
 * Distinct accounts (by email HMAC) that failed a password check from this IP hash within the
 * IP-block window. Used both as a risk signal and for the credential-stuffing block.
 */
export async function ipFailedAccounts(ctx: ServerContext): Promise<number> {
  const since = ctx.clock.now() - THROTTLE_POLICY.ipBlockDuration;
  const row = await ctx.db
    .select({ count: sql<number>`count(distinct ${schema.loginAttempts.emailHmac})` })
    .from(schema.loginAttempts)
    .where(
      and(
        eq(schema.loginAttempts.ipHash, await hashIp(ctx)),
        eq(schema.loginAttempts.outcome, "bad_credentials"),
        gt(schema.loginAttempts.createdAt, since),
      ),
    )
    .get();
  return Number(row?.count ?? 0);
}

/** Gathers the history the risk model needs (90-day successes + recent failures). */
export async function loadLoginHistory(
  ctx: ServerContext,
  userId: string,
  emailHmac: string,
): Promise<LoginHistory> {
  const since = ctx.clock.now() - 90 * DAY;
  const successes = await ctx.db
    .select({
      deviceHash: schema.loginAttempts.deviceHash,
      country: schema.loginAttempts.country,
      asn: schema.loginAttempts.asn,
      createdAt: schema.loginAttempts.createdAt,
    })
    .from(schema.loginAttempts)
    .where(
      and(
        eq(schema.loginAttempts.userId, userId),
        inArray(schema.loginAttempts.outcome, ["success", "mfa_passed", "recovery_used"]),
        gt(schema.loginAttempts.createdAt, since),
      ),
    )
    .orderBy(desc(schema.loginAttempts.createdAt))
    .limit(50)
    .all();
  return {
    successes,
    recentAccountFailures: await recentFailures(ctx, { userId, emailHmac }),
    ipFailedAccounts: await ipFailedAccounts(ctx),
  };
}

export async function recentLoginHistory(ctx: ServerContext, userId: string, limit = 20) {
  return ctx.db
    .select({
      outcome: schema.loginAttempts.outcome,
      createdAt: schema.loginAttempts.createdAt,
      country: schema.loginAttempts.country,
      city: schema.loginAttempts.city,
      userAgent: schema.loginAttempts.userAgent,
      riskScore: schema.loginAttempts.riskScore,
    })
    .from(schema.loginAttempts)
    .where(eq(schema.loginAttempts.userId, userId))
    .orderBy(desc(schema.loginAttempts.createdAt))
    .limit(limit)
    .all();
}
