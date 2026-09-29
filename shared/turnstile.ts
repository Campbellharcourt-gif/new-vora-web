/**
 * Cloudflare's documented Turnstile TEST keys
 * (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). They work on any
 * hostname and always pass, always fail or force a challenge. Fine for local development and
 * tests; never acceptable in staging or production, where an always-pass pair would silently turn
 * bot protection off (CP-2.1 · H1).
 */
export const TURNSTILE_TEST_SITE_KEYS = [
  "1x00000000000000000000AA", // always passes (visible)
  "2x00000000000000000000AB", // always fails (visible)
  "1x00000000000000000000BB", // always passes (invisible)
  "2x00000000000000000000BB", // always fails (invisible)
  "3x00000000000000000000FF", // forces an interactive challenge
] as const;

export const TURNSTILE_TEST_SECRET_KEYS = [
  "1x0000000000000000000000000000000AA", // always passes
  "2x0000000000000000000000000000000AA", // always fails
  "3x0000000000000000000000000000000AA", // "token already spent"
] as const;

/** The shape all of Cloudflare's test keys share, so a future test key is caught too. */
const TEST_KEY_SHAPE = /^[1-3]x0{20,}[A-Z]{2}$/;

/** True for any Cloudflare Turnstile test site key or test secret key. */
export function isTurnstileTestKey(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const key = value.trim();
  if (key.length === 0) return false;
  return (
    (TURNSTILE_TEST_SITE_KEYS as readonly string[]).includes(key) ||
    (TURNSTILE_TEST_SECRET_KEYS as readonly string[]).includes(key) ||
    TEST_KEY_SHAPE.test(key)
  );
}
