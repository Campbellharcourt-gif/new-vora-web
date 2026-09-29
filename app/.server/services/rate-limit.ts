import type { ServerContext } from "../context";
import { hmacHex } from "../lib/crypto";
import { recordSecurityEvent } from "../observability/security-events";

export type LimiterName = "RL_AUTH" | "RL_FORMS" | "RL_API" | "RL_AI";

/**
 * Checks a rate limiter (on Railway: the in-process sliding-window limiter in
 * server/platform/rate-limiter.ts, with the Workers binding's limits — auth 20, forms 6, API 120,
 * AI 12 per 60 s — exact because there is one instance). Keys are derived on the server (hashed
 * client IP or user ID) — never from client-supplied headers. If the limiter itself errors we fail
 * OPEN and log loudly: account-level throttles in the database still protect authentication, and
 * a platform fault must not lock every visitor out.
 */
export async function checkRateLimit(
  ctx: ServerContext,
  limiter: LimiterName,
  scope: string,
  subject?: string,
): Promise<boolean> {
  const who =
    subject ?? (await hmacHex(ctx.config.authSecrets[0] as string, "ip-hash", ctx.meta.ip));
  const key = `${scope}:${who}`;
  try {
    const { success } = await ctx.env[limiter].limit({ key });
    if (!success) {
      await recordSecurityEvent(ctx, {
        type: "rate_limit.exceeded",
        severity: "low",
        details: { limiter, scope },
      });
    }
    return success;
  } catch (error) {
    ctx.log.error("rate_limiter_unavailable", { limiter, scope, error: String(error) });
    return true;
  }
}
