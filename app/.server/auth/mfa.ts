import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { sendSensitive } from "../email/outbox";
import { hmacHex, hmacMatches, randomCrockford, randomDigits } from "../lib/crypto";
import { normaliseCrockford } from "../lib/encoding";
import { newId } from "../lib/ids";
import { HOUR, MINUTE, SECOND } from "../lib/time";
import { hashIp } from "../observability/audit";

export const OTP_POLICY = {
  digits: 6,
  ttl: 10 * MINUTE,
  maxAttempts: 5,
  resendCooldown: 60 * SECOND,
  maxPerHour: 5,
} as const;

export const RECOVERY_CODE_COUNT = 10;

async function otpHmac(ctx: ServerContext, challengeId: string, code: string): Promise<string> {
  // Binding the challenge ID into the MAC means a code can never verify against another challenge.
  return hmacHex(ctx.config.authSecrets[0] as string, "otp", `${challengeId}:${code}`);
}

export type IssueResult =
  | { ok: true; challengeId: string; expiresAt: number }
  | { ok: false; reason: "cooldown" | "hourly_limit" | "send_failed"; retryAfterSeconds?: number };

/**
 * Creates an email one-time code for a pending session and emails it. Enforces a resend cooldown
 * and an hourly cap per user. Older unconsumed challenges for the session are invalidated.
 */
export async function issueEmailChallenge(
  ctx: ServerContext,
  input: {
    userId: string;
    email: string;
    name: string;
    sessionId: string;
    purpose: "login" | "step_up";
  },
): Promise<IssueResult> {
  const now = ctx.clock.now();
  const recent = await ctx.db
    .select({ createdAt: schema.mfaChallenges.createdAt })
    .from(schema.mfaChallenges)
    .where(
      and(
        eq(schema.mfaChallenges.userId, input.userId),
        gt(schema.mfaChallenges.createdAt, now - HOUR),
      ),
    )
    .orderBy(desc(schema.mfaChallenges.createdAt))
    .all();
  const last = recent[0];
  if (last && now - last.createdAt < OTP_POLICY.resendCooldown) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: Math.ceil((OTP_POLICY.resendCooldown - (now - last.createdAt)) / 1000),
    };
  }
  if (recent.length >= OTP_POLICY.maxPerHour) return { ok: false, reason: "hourly_limit" };

  // Invalidate previous open challenges for this session.
  await ctx.db
    .update(schema.mfaChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(schema.mfaChallenges.sessionId, input.sessionId),
        isNull(schema.mfaChallenges.consumedAt),
      ),
    );

  const challengeId = newId("challenge", now);
  const code = randomDigits(OTP_POLICY.digits);
  await ctx.db.insert(schema.mfaChallenges).values({
    id: challengeId,
    userId: input.userId,
    sessionId: input.sessionId,
    factorId: null,
    purpose: input.purpose,
    codeHmac: await otpHmac(ctx, challengeId, code),
    attempts: 0,
    maxAttempts: OTP_POLICY.maxAttempts,
    expiresAt: now + OTP_POLICY.ttl,
    createdAt: now,
    ipHash: await hashIp(ctx),
  });

  const sent = await sendSensitive(ctx, {
    template: "loginCode",
    to: input.email,
    data: { name: input.name, code, minutes: OTP_POLICY.ttl / MINUTE },
    related: { type: "user", id: input.userId },
  });
  if (!sent.ok) return { ok: false, reason: "send_failed" };
  return { ok: true, challengeId, expiresAt: now + OTP_POLICY.ttl };
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_challenge" | "expired" | "too_many_attempts" | "invalid";
      attemptsRemaining?: number;
    };

/**
 * Verifies a code for the session's latest challenge. The attempt counter is incremented
 * atomically BEFORE comparing, and consumption is a conditional update, so parallel guesses
 * cannot exceed the attempt limit and a code can never be used twice.
 */
export async function verifyEmailChallenge(
  ctx: ServerContext,
  input: { sessionId: string; code: string },
): Promise<VerifyResult> {
  const now = ctx.clock.now();
  const challenge = await ctx.db
    .select()
    .from(schema.mfaChallenges)
    .where(
      and(
        eq(schema.mfaChallenges.sessionId, input.sessionId),
        isNull(schema.mfaChallenges.consumedAt),
      ),
    )
    .orderBy(desc(schema.mfaChallenges.createdAt))
    .get();
  if (!challenge) return { ok: false, reason: "no_challenge" };
  if (challenge.expiresAt <= now) return { ok: false, reason: "expired" };

  const bumped = await ctx.db
    .update(schema.mfaChallenges)
    .set({ attempts: sql`${schema.mfaChallenges.attempts} + 1` })
    .where(
      and(
        eq(schema.mfaChallenges.id, challenge.id),
        isNull(schema.mfaChallenges.consumedAt),
        sql`${schema.mfaChallenges.attempts} < ${schema.mfaChallenges.maxAttempts}`,
      ),
    )
    .returning({
      attempts: schema.mfaChallenges.attempts,
      maxAttempts: schema.mfaChallenges.maxAttempts,
    });
  const counted = bumped[0];
  if (!counted) return { ok: false, reason: "too_many_attempts" };

  const matches = await hmacMatches(
    ctx.config.authSecrets,
    "otp",
    `${challenge.id}:${input.code}`,
    challenge.codeHmac,
  );
  if (!matches) {
    const remaining = counted.maxAttempts - counted.attempts;
    return remaining > 0
      ? { ok: false, reason: "invalid", attemptsRemaining: remaining }
      : { ok: false, reason: "too_many_attempts" };
  }

  const consumed = await ctx.db
    .update(schema.mfaChallenges)
    .set({ consumedAt: now })
    .where(and(eq(schema.mfaChallenges.id, challenge.id), isNull(schema.mfaChallenges.consumedAt)))
    .returning({ id: schema.mfaChallenges.id });
  return consumed.length > 0 ? { ok: true } : { ok: false, reason: "invalid" };
}

/** Formats a raw 10-character recovery code for display: ABCDE-12345. */
export function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

async function recoveryHmacs(
  ctx: ServerContext,
  userId: string,
  normalised: string,
): Promise<string[]> {
  return Promise.all(
    ctx.config.authSecrets.map((secret) =>
      hmacHex(secret, "recovery-code", `${userId}:${normalised}`),
    ),
  );
}

/**
 * Generates a fresh set of recovery codes, replacing all unused ones. Returns the plaintext codes
 * exactly once — only HMACs are stored.
 */
export async function generateRecoveryCodes(ctx: ServerContext, userId: string): Promise<string[]> {
  const now = ctx.clock.now();
  const batchId = newId("recovery", now);
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomCrockford(10));
  const secret = ctx.config.authSecrets[0] as string;
  const rows = await Promise.all(
    codes.map(async (code) => ({
      id: newId("recovery", now),
      userId,
      batchId,
      codeHmac: await hmacHex(secret, "recovery-code", `${userId}:${code}`),
      createdAt: now,
    })),
  );
  await ctx.db.batch([
    ctx.db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId)),
    ctx.db.insert(schema.recoveryCodes).values(rows),
  ]);
  return codes.map(formatRecoveryCode);
}

/** Atomically consumes a recovery code. Returns false if unknown or already used. */
export async function consumeRecoveryCode(
  ctx: ServerContext,
  userId: string,
  input: string,
): Promise<boolean> {
  const normalised = normaliseCrockford(input);
  if (normalised.length !== 10) return false;
  const now = ctx.clock.now();
  for (const codeHmac of await recoveryHmacs(ctx, userId, normalised)) {
    const used = await ctx.db
      .update(schema.recoveryCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.recoveryCodes.userId, userId),
          eq(schema.recoveryCodes.codeHmac, codeHmac),
          isNull(schema.recoveryCodes.usedAt),
        ),
      )
      .returning({ id: schema.recoveryCodes.id });
    if (used.length > 0) return true;
  }
  return false;
}

export async function remainingRecoveryCodes(ctx: ServerContext, userId: string): Promise<number> {
  const row = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(schema.recoveryCodes)
    .where(and(eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)))
    .get();
  return Number(row?.count ?? 0);
}
