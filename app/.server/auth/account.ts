import { and, eq, isNull } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";
import { isFlagEnabled } from "../services/flags";
import { checkRateLimit } from "../services/rate-limit";
import { sendSecurityNotice } from "./alerts";
import { generateRecoveryCodes, remainingRecoveryCodes } from "./mfa";
import { breachCount, checkPasswordPolicy } from "./password";
import { passwordHashing } from "./password-hashing";
import { elevateSession, listActiveSessions, revokeSession, revokeUserSessions } from "./sessions";
import { recentLoginHistory } from "./throttle";
import { type Actor, isElevated } from "./types";

async function loadSelf(ctx: ServerContext, actor: Actor) {
  const user = await ctx.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, actor.userId), isNull(schema.users.deletedAt)))
    .get();
  if (!user) throw errors.unauthenticated();
  return user;
}

export async function getSecurityOverview(ctx: ServerContext, actor: Actor) {
  const [sessions, history, recoveryRemaining] = await Promise.all([
    listActiveSessions(ctx, actor.userId),
    recentLoginHistory(ctx, actor.userId, 20),
    remainingRecoveryCodes(ctx, actor.userId),
  ]);
  return {
    sessions: sessions
      .map((s) => ({ ...s, current: s.id === actor.session.id }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    history,
    recoveryRemaining,
    privileged: actor.privileged,
    elevated: isElevated(actor, ctx.clock.now()),
  };
}

/** Step-up: re-enter the password to unlock sensitive actions for 10 minutes. */
export async function elevate(ctx: ServerContext, actor: Actor, password: string): Promise<void> {
  if (!(await checkRateLimit(ctx, "RL_AUTH", "elevate", actor.userId))) throw errors.rateLimited();
  const user = await loadSelf(ctx, actor);
  if (!user.passwordHash || !(await passwordHashing(ctx).verify(password, user.passwordHash))) {
    throw errors.validation({ password: "That password is incorrect." });
  }
  await elevateSession(ctx, actor.session.id);
}

function requireElevated(ctx: ServerContext, actor: Actor): void {
  if (!isElevated(actor, ctx.clock.now())) {
    throw errors.validation(
      { _form: "Confirm your password to continue." },
      "Confirm your password to continue.",
    );
  }
}

export async function changePassword(
  ctx: ServerContext,
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  if (!(await checkRateLimit(ctx, "RL_AUTH", "change-password", actor.userId)))
    throw errors.rateLimited();
  const user = await loadSelf(ctx, actor);
  const passwords = passwordHashing(ctx);
  if (!user.passwordHash || !(await passwords.verify(input.currentPassword, user.passwordHash))) {
    throw errors.validation({ currentPassword: "Your current password is incorrect." });
  }
  const problem = checkPasswordPolicy(input.newPassword, { email: user.email, name: user.name });
  if (problem) throw errors.validation({ newPassword: problem });
  if (input.newPassword === input.currentPassword) {
    throw errors.validation({ newPassword: "Choose a password you haven't used here before." });
  }
  if (await isFlagEnabled(ctx, "auth.breach_check")) {
    const seen = await breachCount(input.newPassword);
    if (seen && seen > 0) {
      throw errors.validation({
        newPassword:
          "This password has appeared in a known data breach. Please choose a different one.",
      });
    }
  }
  const passwordHash = await passwords.hash(input.newPassword);
  const now = ctx.clock.now();
  await ctx.db
    .update(schema.users)
    .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
    .where(eq(schema.users.id, user.id));
  const revoked = await revokeUserSessions(ctx, user.id, "password_changed", actor.session.id);
  await recordSecurityEvent(ctx, {
    type: "auth.password.changed",
    severity: "low",
    userId: user.id,
    details: { otherSessionsRevoked: revoked },
  });
  await writeAudit(ctx, actor, {
    action: "user.password.change",
    targetType: "user",
    targetId: user.id,
    summary: "Changed own password",
  });
  await sendSecurityNotice(
    ctx,
    user,
    "Your password was changed",
    "The password for your VORA account was changed and your other sessions were signed out.",
  );
}

export async function regenerateRecoveryCodes(ctx: ServerContext, actor: Actor): Promise<string[]> {
  requireElevated(ctx, actor);
  const codes = await generateRecoveryCodes(ctx, actor.userId);
  const user = await loadSelf(ctx, actor);
  await recordSecurityEvent(ctx, {
    type: "auth.recovery_codes.regenerated",
    severity: "low",
    userId: actor.userId,
  });
  await writeAudit(ctx, actor, {
    action: "user.recovery_codes.regenerate",
    targetType: "user",
    targetId: actor.userId,
    summary: "Regenerated recovery codes",
  });
  await sendSecurityNotice(
    ctx,
    user,
    "New recovery codes created",
    "A new set of recovery codes was created for your VORA account. Your previous codes no longer work.",
  );
  return codes;
}

/** Revokes one of the actor's OWN sessions. Other users' sessions are managed via security.manage. */
export async function revokeOwnSession(
  ctx: ServerContext,
  actor: Actor,
  sessionId: string,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(sessionId)) throw errors.notFound();
  const owned = await ctx.db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, actor.userId)))
    .get();
  // Same response for "not yours" and "doesn't exist" — no probing other users' sessions.
  if (!owned) throw errors.notFound();
  await revokeSession(ctx, sessionId, "revoked_by_user");
  await writeAudit(ctx, actor, {
    action: "user.session.revoke",
    targetType: "session",
    targetId: sessionId.slice(0, 12),
    summary: "Signed out a session",
  });
}

export async function revokeOtherSessions(ctx: ServerContext, actor: Actor): Promise<number> {
  const count = await revokeUserSessions(ctx, actor.userId, "revoked_by_user", actor.session.id);
  await recordSecurityEvent(ctx, {
    type: "auth.sessions.revoked",
    severity: "info",
    userId: actor.userId,
    details: { sessionCount: count },
  });
  await writeAudit(ctx, actor, {
    action: "user.sessions.revoke_others",
    targetType: "user",
    targetId: actor.userId,
    summary: `Signed out ${count} other session(s)`,
  });
  return count;
}
