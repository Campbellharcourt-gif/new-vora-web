import { and, eq, gt, isNull } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { hmacHex } from "../lib/crypto";
import { recordSecurityEvent } from "../observability/security-events";
import { checkRateLimit } from "../services/rate-limit";
import { verifyTurnstile } from "../services/turnstile";
import { sendNewSignInAlert, sendSecurityNotice } from "./alerts";
import {
  consumeRecoveryCode,
  issueEmailChallenge,
  remainingRecoveryCodes,
  verifyEmailChallenge,
} from "./mfa";
import { needsRehash } from "./password";
import { passwordHashing } from "./password-hashing";
import { loadUserAccess } from "./rbac";
import { assessLoginRisk, RISK_THRESHOLDS } from "./risk";
import { type CreatedSession, createSession, deviceHash, revokeSession } from "./sessions";
import {
  ipFailedAccounts,
  loadLoginHistory,
  recentFailures,
  recordLoginAttempt,
  THROTTLE_POLICY,
} from "./throttle";
import type { PendingSession } from "./types";

export async function emailHmac(ctx: ServerContext, email: string): Promise<string> {
  return hmacHex(ctx.config.authSecrets[0] as string, "email-hash", email.trim().toLowerCase());
}

export type LoginResult =
  | { kind: "signed_in"; session: CreatedSession; userId: string }
  | { kind: "mfa_required"; session: CreatedSession; userId: string; codeSent: boolean }
  | {
      kind: "error";
      code:
        | "invalid_credentials"
        | "locked"
        | "challenge_required"
        | "rate_limited"
        | "account_unavailable";
      /** Present when the next attempt must include a Turnstile token. */
      challengeRequired?: boolean;
    };

const GENERIC_FAILURE = {
  kind: "error",
  code: "invalid_credentials",
} as const satisfies LoginResult;

/**
 * Password sign-in. Identical responses for unknown emails and wrong passwords (including timing
 * via a dummy hash); per-IP rate limit, per-account throttling with Turnstile escalation and
 * temporary lockout; risk-based 2FA; mandatory 2FA for privileged roles.
 */
export async function signIn(
  ctx: ServerContext,
  input: { email: string; password: string; turnstileToken?: string | null },
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const eHmac = await emailHmac(ctx, email);
  const now = ctx.clock.now();

  if (!(await checkRateLimit(ctx, "RL_AUTH", "login"))) {
    await recordLoginAttempt(ctx, { userId: null, emailHmac: eHmac, outcome: "rate_limited" });
    return { kind: "error", code: "rate_limited" };
  }

  // Credential stuffing: too many different accounts failing from this IP hash → refuse for the
  // rest of the window, whatever account is tried next.
  const stuffing = await ipFailedAccounts(ctx);
  if (stuffing >= THROTTLE_POLICY.ipBlockAccounts) {
    await recordLoginAttempt(ctx, { userId: null, emailHmac: eHmac, outcome: "rate_limited" });
    await recordSecurityEvent(ctx, {
      type: "auth.ip.blocked",
      severity: "medium",
      details: { failedAccounts: stuffing },
    });
    return { kind: "error", code: "rate_limited" };
  }

  const user = await ctx.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
    .get();
  const userId = user?.id ?? null;

  const failures = await recentFailures(ctx, { userId, emailHmac: eHmac });

  // Lockout applies to unknown emails too, so lock responses never reveal account existence.
  const lockedByUser = user?.lockedUntil && user.lockedUntil > now;
  if (lockedByUser || failures >= THROTTLE_POLICY.lockAfter) {
    await recordLoginAttempt(ctx, { userId, emailHmac: eHmac, outcome: "locked" });
    return { kind: "error", code: "locked" };
  }

  if (failures >= THROTTLE_POLICY.challengeAfter) {
    const turnstile = await verifyTurnstile(ctx, input.turnstileToken, "login");
    if (!turnstile.ok) {
      await recordLoginAttempt(ctx, { userId, emailHmac: eHmac, outcome: "challenge_failed" });
      return { kind: "error", code: "challenge_required", challengeRequired: true };
    }
  }

  // Argon2id runs natively (node:crypto) behind a bounded queue. If hashing is unavailable (queue
  // full, timeout, derivation error) this throws a 503 BEFORE any attempt is recorded — fail
  // closed, and no failed sign-in is counted against the account.
  const passwords = passwordHashing(ctx);
  let passwordOk = false;
  if (user?.passwordHash) {
    passwordOk = await passwords.verify(input.password, user.passwordHash);
  } else {
    // Unknown email (or no password yet): spend the same time as a real check.
    await passwords.burn(input.password);
  }

  if (!user || !passwordOk) {
    await recordLoginAttempt(ctx, { userId, emailHmac: eHmac, outcome: "bad_credentials" });
    const total = failures + 1;
    if (total >= THROTTLE_POLICY.lockAfter) {
      // Same response on the same attempt for unknown emails (no enumeration via lock timing);
      // only real accounts get the lock flag, the security event and the email.
      if (user) {
        await ctx.db
          .update(schema.users)
          .set({ lockedUntil: now + THROTTLE_POLICY.lockDuration, updatedAt: now })
          .where(eq(schema.users.id, user.id));
        await recordSecurityEvent(ctx, {
          type: "auth.login.locked",
          severity: "medium",
          userId: user.id,
          details: { failures: total },
        });
        await sendSecurityNotice(
          ctx,
          user,
          "Sign-in temporarily locked",
          "We locked sign-in to your VORA account for 15 minutes after repeated failed attempts. If this wasn't you, consider changing your password once the lock ends.",
        );
      }
      return { kind: "error", code: "locked" };
    }
    return total >= THROTTLE_POLICY.challengeAfter
      ? { ...GENERIC_FAILURE, challengeRequired: true }
      : GENERIC_FAILURE;
  }

  if (user.status !== "active") {
    await recordLoginAttempt(ctx, { userId: user.id, emailHmac: eHmac, outcome: "suspended" });
    await recordSecurityEvent(ctx, {
      type: "auth.login.suspended_account",
      severity: "low",
      userId: user.id,
    });
    return { kind: "error", code: "account_unavailable" };
  }

  if (needsRehash(user.passwordHash as string)) {
    const rehashed = await passwords.hash(input.password);
    await ctx.db
      .update(schema.users)
      .set({ passwordHash: rehashed, updatedAt: now })
      .where(eq(schema.users.id, user.id));
  }

  const access = await loadUserAccess(ctx.db, user.id);
  const device = await deviceHash(ctx);
  const history = await loadLoginHistory(ctx, user.id, eHmac);
  const risk = assessLoginRisk(history, {
    deviceHash: device,
    country: ctx.meta.country,
    asn: ctx.meta.asn,
    now,
  });
  const mfaRequired =
    access.privileged || user.mfaEnforced || risk.score >= RISK_THRESHOLDS.requireCode;

  if (risk.score >= RISK_THRESHOLDS.alert) {
    await recordSecurityEvent(ctx, {
      type: "auth.login.suspicious",
      severity: access.privileged ? "high" : "medium",
      userId: user.id,
      details: { score: risk.score, reasons: risk.reasons },
    });
  }

  if (mfaRequired) {
    const session = await createSession(ctx, {
      userId: user.id,
      authLevel: "pending_mfa",
      authMethod: "password",
      privileged: access.privileged,
      mfaVerified: false,
    });
    const issued = await issueEmailChallenge(ctx, {
      userId: user.id,
      email: user.email,
      name: user.name,
      sessionId: session.sessionId,
      purpose: "login",
    });
    return { kind: "mfa_required", session, userId: user.id, codeSent: issued.ok };
  }

  const session = await createSession(ctx, {
    userId: user.id,
    authLevel: "full",
    authMethod: "password",
    privileged: false,
    mfaVerified: false,
  });
  await completeSignIn(ctx, user, eHmac, "success", risk, device, history.successes.length > 0);
  return { kind: "signed_in", session, userId: user.id };
}

async function completeSignIn(
  ctx: ServerContext,
  user: { id: string; email: string; name: string },
  eHmac: string,
  outcome: "success" | "mfa_passed" | "recovery_used",
  risk: { score: number; reasons: string[] },
  device: string,
  hadHistory: boolean,
): Promise<void> {
  const now = ctx.clock.now();
  await recordLoginAttempt(ctx, {
    userId: user.id,
    emailHmac: eHmac,
    outcome,
    riskScore: risk.score,
    riskReasons: risk.reasons,
    deviceHash: device,
  });
  await ctx.db
    .update(schema.users)
    .set({ lastLoginAt: now, lockedUntil: null, updatedAt: now })
    .where(eq(schema.users.id, user.id));
  if (hadHistory && (risk.reasons.includes("new_device") || risk.reasons.includes("new_country"))) {
    await sendNewSignInAlert(ctx, user);
  }
}

/**
 * Re-checks the pending session inside the operation (not just when the request started), so a
 * session revoked by a parallel request — e.g. one that exhausted the code attempts — cannot be
 * completed by a request already in flight.
 */
async function loadPendingUser(ctx: ServerContext, pending: PendingSession) {
  const row = await ctx.db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.id, pending.sessionId),
        eq(schema.sessions.userId, pending.userId),
        eq(schema.sessions.authLevel, "pending_mfa"),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, ctx.clock.now()),
      ),
    )
    .get();
  if (row?.user.status !== "active") return null;
  return row.user;
}

export type SecondStepResult =
  | { kind: "signed_in"; session: CreatedSession; userId: string }
  | {
      kind: "error";
      code:
        | "invalid_code"
        | "expired"
        | "too_many_attempts"
        | "rate_limited"
        | "session_expired"
        | "invalid_recovery_code";
      attemptsRemaining?: number;
    };

/** Completes a pending sign-in with the emailed code; rotates to a full session on success. */
export async function verifySignInCode(
  ctx: ServerContext,
  pending: PendingSession,
  code: string,
): Promise<SecondStepResult> {
  if (!(await checkRateLimit(ctx, "RL_AUTH", "login-verify")))
    return { kind: "error", code: "rate_limited" };
  const user = await loadPendingUser(ctx, pending);
  if (!user) return { kind: "error", code: "session_expired" };
  const eHmac = await emailHmac(ctx, user.email);

  const result = await verifyEmailChallenge(ctx, { sessionId: pending.sessionId, code });
  if (!result.ok) {
    await recordLoginAttempt(ctx, { userId: user.id, emailHmac: eHmac, outcome: "mfa_failed" });
    if (result.reason === "too_many_attempts") {
      await recordSecurityEvent(ctx, {
        type: "auth.mfa.failed_limit",
        severity: "medium",
        userId: user.id,
      });
      await revokeSession(ctx, pending.sessionId, "mfa_attempts_exhausted");
      return { kind: "error", code: "too_many_attempts" };
    }
    if (result.reason === "expired" || result.reason === "no_challenge")
      return { kind: "error", code: "expired" };
    return {
      kind: "error",
      code: "invalid_code",
      ...(result.attemptsRemaining !== undefined
        ? { attemptsRemaining: result.attemptsRemaining }
        : {}),
    };
  }
  return finishSecondStep(ctx, pending, user, eHmac, "password+email_otp", "mfa_passed");
}

/** Completes a pending sign-in with a recovery code (alerts the account holder). */
export async function verifySignInRecoveryCode(
  ctx: ServerContext,
  pending: PendingSession,
  code: string,
): Promise<SecondStepResult> {
  if (!(await checkRateLimit(ctx, "RL_AUTH", "login-recovery")))
    return { kind: "error", code: "rate_limited" };
  const user = await loadPendingUser(ctx, pending);
  if (!user) return { kind: "error", code: "session_expired" };
  const eHmac = await emailHmac(ctx, user.email);

  const failures = await recentFailures(ctx, { userId: user.id, emailHmac: eHmac });
  if (failures >= THROTTLE_POLICY.lockAfter) {
    await revokeSession(ctx, pending.sessionId, "recovery_attempts_exhausted");
    return { kind: "error", code: "too_many_attempts" };
  }

  if (!(await consumeRecoveryCode(ctx, user.id, code))) {
    await recordLoginAttempt(ctx, { userId: user.id, emailHmac: eHmac, outcome: "mfa_failed" });
    return { kind: "error", code: "invalid_recovery_code" };
  }
  const remaining = await remainingRecoveryCodes(ctx, user.id);
  await recordSecurityEvent(ctx, {
    type: "auth.recovery_code.used",
    severity: "medium",
    userId: user.id,
    details: { remaining },
  });
  await sendSecurityNotice(
    ctx,
    user,
    "A recovery code was used",
    `A recovery code was just used to sign in to your VORA account. You have ${remaining} unused recovery code${remaining === 1 ? "" : "s"} left.`,
  );
  return finishSecondStep(ctx, pending, user, eHmac, "password+recovery_code", "recovery_used");
}

async function finishSecondStep(
  ctx: ServerContext,
  pending: PendingSession,
  user: { id: string; email: string; name: string },
  eHmac: string,
  authMethod: string,
  outcome: "mfa_passed" | "recovery_used",
): Promise<SecondStepResult> {
  const access = await loadUserAccess(ctx.db, user.id);
  const device = await deviceHash(ctx);
  const history = await loadLoginHistory(ctx, user.id, eHmac);
  const risk = assessLoginRisk(history, {
    deviceHash: device,
    country: ctx.meta.country,
    asn: ctx.meta.asn,
    now: ctx.clock.now(),
  });
  await revokeSession(ctx, pending.sessionId, "mfa_completed");
  const session = await createSession(ctx, {
    userId: user.id,
    authLevel: "full",
    authMethod,
    privileged: access.privileged,
    mfaVerified: true,
  });
  await completeSignIn(ctx, user, eHmac, outcome, risk, device, history.successes.length > 0);
  return { kind: "signed_in", session, userId: user.id };
}

/** Where a user lands after signing in when no explicit destination was requested. */
export async function homePathFor(ctx: ServerContext, userId: string): Promise<string> {
  const access = await loadUserAccess(ctx.db, userId);
  if (access.permissions.has("admin.access")) return "/admin";
  if (access.permissions.has("client_portal.access")) return "/client";
  if (access.permissions.has("member_portal.access")) return "/member";
  return "/account";
}

/** Re-sends the sign-in code for a pending session (cooldown and hourly caps apply). */
export async function resendSignInCode(ctx: ServerContext, pending: PendingSession) {
  if (!(await checkRateLimit(ctx, "RL_AUTH", "login-resend"))) {
    return { ok: false as const, reason: "rate_limited" as const };
  }
  const user = await loadPendingUser(ctx, pending);
  if (!user) return { ok: false as const, reason: "session_expired" as const };
  return issueEmailChallenge(ctx, {
    userId: user.id,
    email: user.email,
    name: user.name,
    sessionId: pending.sessionId,
    purpose: "login",
  });
}
