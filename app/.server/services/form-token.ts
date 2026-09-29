import type { ServerContext } from "../context";
import { hmacHex, hmacMatches, randomToken } from "../lib/crypto";
import { DAY, SECOND } from "../lib/time";

/**
 * Signed form tokens: `<issuedAt>.<nonce>.<mac>`, rendered into public forms.
 * - proves the submission came from a form we rendered (no blind POSTs),
 * - rejects submissions faster than a human could type (bot timing),
 * - expires after a day,
 * - the nonce doubles as the idempotency key, so double-submits create one record.
 */
export const FORM_TOKEN_POLICY = { minAge: 3 * SECOND, maxAge: DAY } as const;

export async function issueFormToken(ctx: ServerContext, form: string): Promise<string> {
  const issuedAt = ctx.clock.now();
  const nonce = randomToken(16);
  const mac = await hmacHex(
    ctx.config.authSecrets[0] as string,
    "form-token",
    `${form}|${issuedAt}|${nonce}`,
  );
  return `${issuedAt}.${nonce}.${mac}`;
}

export type FormTokenCheck =
  | { ok: true; nonce: string }
  | { ok: false; reason: "malformed" | "invalid" | "expired" | "too_fast" };

export async function verifyFormToken(
  ctx: ServerContext,
  form: string,
  token: unknown,
): Promise<FormTokenCheck> {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };
  const match = /^(\d{13})\.([A-Za-z0-9_-]{22})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return { ok: false, reason: "malformed" };
  const [, issued, nonce, mac] = match as unknown as [string, string, string, string];
  const valid = await hmacMatches(
    ctx.config.authSecrets,
    "form-token",
    `${form}|${issued}|${nonce}`,
    mac,
  );
  if (!valid) return { ok: false, reason: "invalid" };
  const age = ctx.clock.now() - Number(issued);
  if (age > FORM_TOKEN_POLICY.maxAge || age < -60 * SECOND) return { ok: false, reason: "expired" };
  if (age < FORM_TOKEN_POLICY.minAge) return { ok: false, reason: "too_fast" };
  return { ok: true, nonce };
}
