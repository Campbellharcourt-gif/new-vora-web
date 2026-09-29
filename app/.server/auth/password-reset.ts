import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { sendSensitive } from "../email/outbox";
import { randomToken, sha256Hex } from "../lib/crypto";
import { errors } from "../lib/errors";
import { newId } from "../lib/ids";
import { HOUR, MINUTE } from "../lib/time";
import { writeAudit } from "../observability/audit";
import { describeError } from "../observability/logger";
import { recordSecurityEvent } from "../observability/security-events";
import { isFlagEnabled } from "../services/flags";
import { checkRateLimit } from "../services/rate-limit";
import { sendSecurityNotice } from "./alerts";
import { breachCount, checkPasswordPolicy } from "./password";
import { passwordHashing } from "./password-hashing";
import { revokeUserSessions } from "./sessions";

export const RESET_POLICY = { ttl: 30 * MINUTE, maxPerHour: 3 } as const;

/**
 * Always resolves the same way whether or not the email has an account (no enumeration).
 * Only active accounts receive a link; tokens are stored hashed and are single-use.
 */
export async function requestPasswordReset(ctx: ServerContext, rawEmail: string): Promise<void> {
  if (!(await checkRateLimit(ctx, "RL_AUTH", "password-reset"))) return;
  const email = rawEmail.trim().toLowerCase();
  const user = await ctx.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
    .get();
  if (user?.status !== "active") return;

  const now = ctx.clock.now();
  const recent = await ctx.db
    .select({ n: count() })
    .from(schema.authTokens)
    .where(
      and(
        eq(schema.authTokens.userId, user.id),
        eq(schema.authTokens.type, "password_reset"),
        gt(schema.authTokens.createdAt, now - HOUR),
      ),
    )
    .get();
  if ((recent?.n ?? 0) >= RESET_POLICY.maxPerHour) return;

  const token = randomToken(32);
  await ctx.db.batch([
    // Any earlier unused reset link stops working.
    ctx.db
      .update(schema.authTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.authTokens.userId, user.id),
          eq(schema.authTokens.type, "password_reset"),
          isNull(schema.authTokens.consumedAt),
        ),
      ),
    ctx.db.insert(schema.authTokens).values({
      id: newId("token", now),
      userId: user.id,
      type: "password_reset",
      tokenHash: await sha256Hex(token),
      payload: null,
      expiresAt: now + RESET_POLICY.ttl,
      createdAt: now,
    }),
  ]);
  await sendSensitive(ctx, {
    template: "passwordReset",
    to: user.email,
    data: {
      name: user.name,
      url: `${ctx.config.origin}/reset-password/${token}`,
      minutes: RESET_POLICY.ttl / MINUTE,
    },
    related: { type: "user", id: user.id },
  });
}

/**
 * Entry point for the "forgot password" form. The account lookup, token and email all run after
 * the response has been sent, so the response takes the same time whether or not the address has
 * an account — no timing oracle for account enumeration (found in CP-2: ~11 ms locally, and a
 * full email-provider round trip in production).
 */
export function requestPasswordResetInBackground(ctx: ServerContext, rawEmail: string): void {
  ctx.waitUntil(
    requestPasswordReset(ctx, rawEmail).catch((error: unknown) =>
      ctx.log.error("password_reset_request_failed", describeError(error)),
    ),
  );
}

async function findValidResetToken(ctx: ServerContext, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await ctx.db
    .select({ token: schema.authTokens, user: schema.users })
    .from(schema.authTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.authTokens.userId))
    .where(
      and(
        eq(schema.authTokens.tokenHash, await sha256Hex(token)),
        eq(schema.authTokens.type, "password_reset"),
        isNull(schema.authTokens.consumedAt),
        gt(schema.authTokens.expiresAt, ctx.clock.now()),
      ),
    )
    .get();
  if (row?.user.status !== "active") return null;
  return row;
}

export async function isResetTokenValid(ctx: ServerContext, token: string): Promise<boolean> {
  return (await findValidResetToken(ctx, token)) !== null;
}

/** Validates, checks the policy, consumes the token atomically, sets the password, signs out everywhere. */
export async function completePasswordReset(
  ctx: ServerContext,
  token: string,
  newPassword: string,
): Promise<void> {
  const found = await findValidResetToken(ctx, token);
  if (!found)
    throw errors.validation({
      _form: "This reset link is invalid or has expired. Request a new one.",
    });
  const { user } = found;

  const problem = checkPasswordPolicy(newPassword, { email: user.email, name: user.name });
  if (problem) throw errors.validation({ password: problem });
  if (await isFlagEnabled(ctx, "auth.breach_check")) {
    const seen = await breachCount(newPassword);
    if (seen && seen > 0) {
      throw errors.validation({
        password:
          "This password has appeared in a known data breach. Please choose a different one.",
      });
    }
  }

  // Hash BEFORE consuming the single-use token: if hashing is unavailable (503), the link still
  // works for a retry instead of being burned with the password unchanged.
  const passwordHash = await passwordHashing(ctx).hash(newPassword);
  const now = ctx.clock.now();
  const consumed = await ctx.db
    .update(schema.authTokens)
    .set({ consumedAt: now })
    .where(and(eq(schema.authTokens.id, found.token.id), isNull(schema.authTokens.consumedAt)))
    .returning({ id: schema.authTokens.id });
  if (consumed.length === 0)
    throw errors.validation({ _form: "This reset link has already been used." });

  await ctx.db
    .update(schema.users)
    .set({
      passwordHash,
      passwordChangedAt: now,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(schema.users.id, user.id));
  const revoked = await revokeUserSessions(ctx, user.id, "password_reset");
  await recordSecurityEvent(ctx, {
    type: "auth.password.reset",
    severity: "medium",
    userId: user.id,
    details: { sessionsRevoked: revoked },
  });
  await writeAudit(
    ctx,
    { userId: user.id, roles: [] },
    {
      action: "user.password.reset",
      targetType: "user",
      targetId: user.id,
      summary: "Password reset via emailed link",
    },
  );
  await sendSecurityNotice(
    ctx,
    user,
    "Your password was changed",
    "The password for your VORA account was just reset, and all sessions were signed out.",
  );
}
