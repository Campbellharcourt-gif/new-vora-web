import { type Bytes, CROCKFORD, toBase64Url, toHex, utf8 } from "./encoding";

/** Cryptographically secure random bytes (Web Crypto). */
export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** URL-safe opaque token with `bytes` of entropy (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

/** Uniform random integer in [0, max) using rejection sampling (no modulo bias). */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new Error("Invalid bound");
  const limit = 2 ** 32 - (2 ** 32 % max);
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    const n = buf[0] as number;
    if (n < limit) return n % max;
  }
}

/** Numeric one-time code, e.g. "042317". */
export function randomDigits(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomInt(10));
  return out;
}

/** Random Crockford base32 string of the given length (5 bits per char). */
export function randomCrockford(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CROCKFORD[randomInt(32)];
  return out;
}

export async function sha256(data: string | Bytes): Promise<Bytes> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function sha256Hex(data: string | Bytes): Promise<string> {
  return toHex(await sha256(data));
}

/** Constant-time comparison of two byte arrays / strings of equal length. */
export function timingSafeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const x = typeof a === "string" ? utf8(a) : a;
  const y = typeof b === "string" ? utf8(b) : b;
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Purpose-bound keys derived from AUTH_SECRET with HKDF-SHA256. Each purpose gets an
 * independent key, so a leak or misuse in one context cannot forge values in another.
 */
export type KeyPurpose =
  | "otp"
  | "recovery-code"
  | "ip-hash"
  | "email-hash"
  | "form-token"
  | "preview-token"
  | "device-hash"
  | "mfa-secret";

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveHmacKey(secret: string, purpose: KeyPurpose): Promise<CryptoKey> {
  const cacheKey = `${purpose}\u0000${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: utf8("vora/v1"), info: utf8(`vora:${purpose}`) },
        base,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign", "verify"],
      );
    })();
    keyCache.set(cacheKey, key);
  }
  return key;
}

export async function hmacHex(secret: string, purpose: KeyPurpose, value: string): Promise<string> {
  const key = await deriveHmacKey(secret, purpose);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(value));
  return toHex(sig);
}

/** Verifies an HMAC against the current secret and, during rotation, the previous one. */
export async function hmacMatches(
  secrets: readonly string[],
  purpose: KeyPurpose,
  value: string,
  expectedHex: string,
): Promise<boolean> {
  let match = false;
  for (const secret of secrets) {
    const candidate = await hmacHex(secret, purpose, value);
    // Evaluate every secret to keep timing independent of which one matched.
    if (timingSafeEqual(candidate, expectedHex)) match = true;
  }
  return match;
}
