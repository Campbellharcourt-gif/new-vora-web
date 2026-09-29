import { isTurnstileTestKey } from "@shared/turnstile";
import type { ServerContext } from "../context";
import { recordSecurityEvent } from "../observability/security-events";

export interface TurnstileResult {
  ok: boolean;
  /** "skipped" only in development/test when no secret is configured. */
  reason?:
    | "missing_token"
    | "failed"
    | "timeout"
    | "hostname_mismatch"
    | "action_mismatch"
    | "skipped";
}

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Server-side Turnstile verification (mandatory — the widget alone protects nothing). Tokens are
 * single-use and expire after 5 minutes; hostname and action are checked against expectations.
 */
export async function verifyTurnstile(
  ctx: ServerContext,
  token: string | null | undefined,
  expectedAction: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = ctx.config.turnstile.secretKey;
  if (!secret) {
    // Config validation makes the secret mandatory in staging/production.
    return ctx.config.isProductionLike
      ? { ok: false, reason: "failed" }
      : { ok: true, reason: "skipped" };
  }
  if (!token || token.length > 2048) {
    return { ok: false, reason: "missing_token" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const body = new FormData();
    body.append("secret", secret);
    body.append("response", token);
    body.append("remoteip", ctx.meta.ip);
    body.append("idempotency_key", crypto.randomUUID());
    const res = await fetchImpl(SITEVERIFY, { method: "POST", body, signal: controller.signal });
    const data = (await res.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
      "error-codes"?: string[];
    };
    if (!data.success) {
      await recordSecurityEvent(ctx, {
        type: "turnstile.failed",
        severity: "low",
        details: { action: expectedAction, codes: data["error-codes"] ?? [] },
      });
      return { ok: false, reason: "failed" };
    }
    // Cloudflare's public test secrets report a placeholder hostname/action, so those checks are
    // relaxed for them — but only in development/test. Configuration validation already refuses
    // test keys in staging/production (CP-2.1 · H1); this keeps the checks on there regardless.
    const relaxedForTestKey = isTurnstileTestKey(secret) && !ctx.config.isProductionLike;
    if (!relaxedForTestKey) {
      if (data.hostname && data.hostname !== ctx.config.host.split(":")[0]) {
        return { ok: false, reason: "hostname_mismatch" };
      }
      if (data.action && data.action !== expectedAction) {
        return { ok: false, reason: "action_mismatch" };
      }
    }
    return { ok: true };
  } catch (error) {
    ctx.log.warn("turnstile_unavailable", { error: String(error) });
    return { ok: false, reason: "timeout" };
  } finally {
    clearTimeout(timer);
  }
}
