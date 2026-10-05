import type { SecuritySeverity } from "@shared/enums";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { newId } from "../lib/ids";
import { hashIp } from "./audit";
import { describeError } from "./logger";

/** Stable identifiers for security-relevant events. */
export type SecurityEventType =
  | "auth.login.rate_limited"
  | "auth.login.locked"
  | "auth.login.suspicious"
  | "auth.login.suspended_account"
  | "auth.mfa.failed_limit"
  | "auth.recovery_code.used"
  | "auth.recovery_codes.regenerated"
  | "auth.password.changed"
  | "auth.password.reset"
  | "auth.sessions.revoked"
  | "auth.ip.blocked"
  | "auth.owner.bootstrapped"
  | "auth.setup.rejected"
  | "authz.denied"
  | "csrf.rejected"
  | "rate_limit.exceeded"
  | "spam.detected"
  | "turnstile.failed"
  | "upload.rejected"
  | "ai.abuse"
  | "config.invalid"
  | "roles.changed"
  | "roles.definition.changed"
  | "auth.two_step.enabled"
  | "auth.two_step.disabled"
  | "auth.sessions.revoked_by_admin"
  | "privacy.account_deleted"
  | "maintenance.changed";

export interface SecurityEventInput {
  type: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string | null;
  /** Redacted by the logger's rules before storage — never pass secrets. */
  details?: Record<string, unknown>;
}

/**
 * Records a security event (append-only table) and logs it. Recording must never break the
 * request that triggered it, so storage failures are logged loudly instead of thrown.
 */
export async function recordSecurityEvent(
  ctx: ServerContext,
  event: SecurityEventInput,
): Promise<void> {
  const level = event.severity === "high" || event.severity === "critical" ? "error" : "warn";
  ctx.log[level]("security_event", {
    type: event.type,
    severity: event.severity,
    userId: event.userId ?? undefined,
    ...(event.details ? { details: event.details } : {}),
  });
  try {
    await ctx.db.insert(schema.securityEvents).values({
      id: newId("securityEvent", ctx.clock.now()),
      type: event.type,
      severity: event.severity,
      userId: event.userId ?? null,
      ipHash: await hashIp(ctx),
      country: ctx.meta.country,
      userAgent: ctx.meta.userAgent.slice(0, 256),
      details: event.details ?? null,
      requestId: ctx.requestId,
      createdAt: ctx.clock.now(),
    });
  } catch (error) {
    ctx.log.error("security_event_store_failed", { type: event.type, ...describeError(error) });
  }
}
