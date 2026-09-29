import { argon2 } from "node:crypto";
import { PASSWORD_MAX, PASSWORD_MIN } from "@shared/validation/auth";
import { randomBytes, timingSafeEqual } from "../lib/crypto";
import { fromBase64, toBase64, toHex, utf8 } from "../lib/encoding";

/**
 * Password hashing with Argon2id (OWASP Password Storage Cheat Sheet parameters), encoded in the
 * PHC string format so parameters can be upgraded later without breaking existing hashes.
 *
 * Railway migration R2: the key derivation is Node's built-in `crypto.argon2` (OpenSSL, native,
 * run on the libuv threadpool so the event loop stays free) instead of `@noble/hashes` in a
 * Durable Object. Parameters, NFKC input, salt and tag lengths and the PHC encoding are identical;
 * the output is byte-for-byte the same (tests/unit/argon2-native.test.ts cross-checks it against
 * `@noble/hashes`, which stays as a development dependency for exactly that). Existing hashes
 * verify unchanged.
 */
export const ARGON2_PARAMS = { m: 19_456, t: 2, p: 1 } as const;
const DK_LEN = 32;
const SALT_LEN = 16;

/** Argon2id through OpenSSL. `m` is in KiB, `t` passes, `p` lanes — the same meaning as before. */
export function deriveArgon2id(
  password: string,
  salt: Uint8Array,
  params: { m: number; t: number; p: number },
  tagLength: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: utf8(password.normalize("NFKC")),
        nonce: salt,
        parallelism: params.p,
        tagLength,
        memory: params.m,
        passes: params.t,
      },
      (error, derived) => {
        if (error) reject(error);
        else resolve(new Uint8Array(derived.buffer, derived.byteOffset, derived.byteLength));
      },
    );
  });
}

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
  const hash = await deriveArgon2id(password, salt, ARGON2_PARAMS, DK_LEN);
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
  const candidate = await deriveArgon2id(password, parsed.salt, parsed, parsed.hash.length);
  return timingSafeEqual(candidate, parsed.hash);
}

/**
 * Start-up self-test (migration §5.1 rule 3): a known-answer vector computed with `@noble/hashes`
 * (the implementation that produced every existing hash) must come out of the native
 * implementation byte for byte. The server refuses to start otherwise, so it can never run
 * without Argon2id or fall back to anything weaker.
 */
export const ARGON2_KNOWN_ANSWER = {
  password: "vora-argon2id-known-answer-v1",
  salt: Uint8Array.from({ length: SALT_LEN }, (_, i) => i),
  hash: "QmTFrZe4rOVxO5az2rLuVUjOfcDpvQ+r993maAF5YIk",
} as const;

export async function argon2SelfTest(
  derive: typeof deriveArgon2id = deriveArgon2id,
): Promise<void> {
  const { password, salt, hash } = ARGON2_KNOWN_ANSWER;
  const derived = b64(await derive(password, salt, ARGON2_PARAMS, DK_LEN));
  if (derived !== hash) throw new Error("Argon2id self-test failed: wrong known-answer output");
  if (!isPolicyHash(TIMING_DUMMY_HASH)) throw new Error("Argon2id self-test failed: dummy hash");
  const fresh = await hashPassword(password);
  if (!isPolicyHash(fresh) || !(await verifyPassword(password, fresh))) {
    throw new Error("Argon2id self-test failed: hash/verify round trip");
  }
}

/** True when a stored hash uses weaker parameters than the current policy. */
export function needsRehash(encoded: string): boolean {
  const parsed = parseHash(encoded);
  if (!parsed) return true;
  return parsed.m < ARGON2_PARAMS.m || parsed.t < ARGON2_PARAMS.t || parsed.hash.length < DK_LEN;
}

/**
 * True only for a hash made exactly the way hashPassword() makes one today: Argon2id with the
 * policy parameters, a 16-byte salt and a 32-byte output. Every hash is checked with it before it
 * is stored (auth/password-hashing.ts).
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
 * one policy-strength verification: the timing-parity work for unknown emails. Not a secret.
 * tests/unit/password-hashing.test.ts keeps it on ARGON2_PARAMS.
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
