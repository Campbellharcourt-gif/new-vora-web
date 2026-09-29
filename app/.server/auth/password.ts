import { argon2idAsync } from "@noble/hashes/argon2.js";
import { PASSWORD_MAX, PASSWORD_MIN } from "@shared/validation/auth";
import { randomBytes, timingSafeEqual } from "../lib/crypto";
import { fromBase64, toBase64, toHex, utf8 } from "../lib/encoding";

/**
 * Password hashing with Argon2id (OWASP Password Storage Cheat Sheet parameters), encoded in the
 * PHC string format so parameters can be upgraded later without breaking existing hashes.
 */
export const ARGON2_PARAMS = { m: 19_456, t: 2, p: 1 } as const;
const DK_LEN = 32;
const SALT_LEN = 16;

interface ParsedHash {
  m: number;
  t: number;
  p: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

const b64 = (bytes: Uint8Array) => toBase64(bytes).replace(/=+$/, "");
const unb64 = (value: string) => fromBase64(value + "===".slice((value.length + 3) % 4));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await argon2idAsync(utf8(password.normalize("NFKC")), salt, {
    ...ARGON2_PARAMS,
    dkLen: DK_LEN,
  });
  const { m, t, p } = ARGON2_PARAMS;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
}

export function parseHash(encoded: string): ParsedHash | null {
  const match =
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded);
  if (!match) return null;
  const [, m, t, p, salt, hash] = match;
  try {
    return {
      m: Number(m),
      t: Number(t),
      p: Number(p),
      salt: unb64(salt as string),
      hash: unb64(hash as string),
    };
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) return false;
  // Guard against absurd parameters in a tampered hash (CPU/memory exhaustion).
  if (parsed.m > 262_144 || parsed.t > 10 || parsed.p > 4) return false;
  const candidate = await argon2idAsync(utf8(password.normalize("NFKC")), parsed.salt, {
    m: parsed.m,
    t: parsed.t,
    p: parsed.p,
    dkLen: parsed.hash.length,
  });
  return timingSafeEqual(candidate, parsed.hash);
}

/** True when a stored hash uses weaker parameters than the current policy. */
export function needsRehash(encoded: string): boolean {
  const parsed = parseHash(encoded);
  if (!parsed) return true;
  return parsed.m < ARGON2_PARAMS.m || parsed.t < ARGON2_PARAMS.t || parsed.hash.length < DK_LEN;
}

/**
 * True only for a hash made exactly the way hashPassword() makes one today: Argon2id with the
 * policy parameters, a 16-byte salt and a 32-byte output. Hashes computed outside this isolate
 * (the PasswordHasher Durable Object) are checked with it before they are stored.
 */
export function isPolicyHash(encoded: string): boolean {
  const parsed = parseHash(encoded);
  return (
    parsed !== null &&
    parsed.m === ARGON2_PARAMS.m &&
    parsed.t === ARGON2_PARAMS.t &&
    parsed.p === ARGON2_PARAMS.p &&
    parsed.salt.length === SALT_LEN &&
    parsed.hash.length === DK_LEN
  );
}

/**
 * A fixed Argon2id hash (policy parameters) of a random 32-byte value that was discarded when it
 * was generated, so no password verifies against it. Checking a password against it costs exactly
 * one policy-strength verification: the timing-parity work for unknown emails when hashing runs in
 * the PasswordHasher Durable Object, where a lazily computed dummy would cost a second hash on
 * every fresh object. Not a secret. tests/unit/password-hashing.test.ts keeps it on ARGON2_PARAMS.
 */
export const TIMING_DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$XyPuBSigwc/mfEsCNPBQJQ$iBU5RknpXURw2HKzS8qUBPVaQ819FHDTF+R6XyJHl5Q";

let dummyHash: Promise<string> | null = null;

/**
 * Runs a full verification against a fixed dummy hash so that "unknown email" and "wrong
 * password" take the same time (prevents account enumeration via timing).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("vora-timing-parity-dummy-password");
  await verifyPassword(password, await dummyHash);
}

/** Most common passwords of 12+ characters (a small local list; the breach check covers the rest). */
const COMMON = new Set([
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwertyuiopasdf",
  "password1234",
  "password12345",
  "passwordpassword",
  "iloveyou1234",
  "qwerty123456",
  "abc123456789",
  "111111111111",
  "000000000000",
  "aaaaaaaaaaaa",
  "letmein12345",
  "welcome12345",
  "administrator",
  "changeme1234",
  "1q2w3e4r5t6y",
  "zaq12wsxcde3",
  "correcthorsebatterystaple",
]);

export interface PasswordPolicyContext {
  email?: string;
  name?: string;
}

/** Returns a user-facing problem with the password, or null if acceptable. */
export function checkPasswordPolicy(
  password: string,
  context: PasswordPolicyContext = {},
): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Choose something less predictable.";
  if (/^(.)\1+$/.test(password)) return "Avoid repeating a single character.";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    return "Your password shouldn't contain your email address.";
  }
  for (const part of (context.name ?? "").toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part))
      return "Your password shouldn't contain your name.";
  }
  if (lower.includes("vora")) return "Your password shouldn't contain the word VORA.";
  return null;
}

/**
 * Have I Been Pwned k-anonymity range check: only the first 5 hex characters of the SHA-1 are
 * sent. Fails open (returns null) on timeout or error so an outage never blocks sign-up.
 */
export async function breachCount(
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<number | null> {
  const digest = toHex(await crypto.subtle.digest("SHA-1", utf8(password))).toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "VORA-password-check" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
