import { randomBytes } from "node:crypto";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { describe, expect, it } from "vitest";
import {
  ARGON2_KNOWN_ANSWER,
  ARGON2_PARAMS,
  argon2SelfTest,
  deriveArgon2id,
  hashPassword,
  isPolicyHash,
  needsRehash,
  parseHash,
  TIMING_DUMMY_HASH,
  verifyPassword,
} from "~/.server/auth/password";

/**
 * Railway migration R2 (§5.1, §13.2 item 1): Node's native `crypto.argon2` must produce exactly
 * what `@noble/hashes` produced on Workers — the library that made every existing VORA hash — so
 * no stored password stops working and no new hash differs in format or strength. `@noble/hashes`
 * stays as a development dependency for this cross-check only.
 */

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").replace(/=+$/, "");

async function noble(password: string, salt: Uint8Array): Promise<string> {
  return b64(
    await argon2idAsync(new TextEncoder().encode(password.normalize("NFKC")), salt, {
      ...ARGON2_PARAMS,
      dkLen: 32,
    }),
  );
}

async function native(password: string, salt: Uint8Array): Promise<string> {
  return b64(await deriveArgon2id(password, salt, ARGON2_PARAMS, 32));
}

/** Hashes made by CP-3's code path (@noble/hashes 2.4.0, policy parameters, PHC encoding). */
const CP3_HASHES: [string, string][] = [
  [
    "correct-horse-battery-staple-42",
    "$argon2id$v=19$m=19456,t=2,p=1$dm9yYS1jcDMtc2FsdC0wMQ$le0fQU4tIlV25fwk54ylxNUmGcLs3RpXAi+XbgTG/48",
  ],
  [
    "Ünïcödé pässwörd ｆｕｌｌｗｉｄｔｈ 2026",
    "$argon2id$v=19$m=19456,t=2,p=1$dm9yYS1jcDMtc2FsdC0wMQ$SwKO5v1p8t1Y72FKvMpUojx5W0jdYVXYkpp3IX3CuJw",
  ],
];

describe("native Argon2id = @noble/hashes (byte for byte)", { timeout: 60_000 }, () => {
  it("matches on edge-case and random vectors with VORA's parameters", async () => {
    const vectors = [
      "",
      "a",
      "correct-horse-battery-staple-42",
      "x".repeat(256),
      "Ünïcödé ｆｕｌｌｗｉｄｔｈ ﬁ ligature", // NFKC changes these
      "emoji 🔐🏔️ and ZWJ 👩‍💻",
      'tab\tnewline\nquote"backslash\\',
      randomBytes(24).toString("base64"),
      randomBytes(48).toString("hex"),
      String.fromCodePoint(
        ...Array.from({ length: 32 }, () => 0x20 + Math.floor(Math.random() * 0x2000)),
      ),
    ];
    for (const password of vectors) {
      const salt = new Uint8Array(randomBytes(16));
      expect(await native(password, salt), JSON.stringify(password)).toBe(
        await noble(password, salt),
      );
    }
  });

  it("reproduces the known-answer vector the start-up self-test uses", async () => {
    const { password, salt, hash } = ARGON2_KNOWN_ANSWER;
    expect(await noble(password, salt)).toBe(hash);
    expect(await native(password, salt)).toBe(hash);
  });

  it("verifies hashes made by CP-3's implementation, and rejects wrong passwords", async () => {
    for (const [password, encoded] of CP3_HASHES) {
      expect(isPolicyHash(encoded)).toBe(true);
      expect(needsRehash(encoded)).toBe(false);
      expect(await verifyPassword(password, encoded)).toBe(true);
      expect(await verifyPassword(`${password} `, encoded)).toBe(false);
    }
  });

  it("new hashes keep the PHC format and parameters, and @noble verifies them too", async () => {
    const password = "a sensible passphrase for 2026";
    const encoded = await hashPassword(password);
    expect(encoded).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    const parsed = parseHash(encoded);
    expect(parsed).toMatchObject(ARGON2_PARAMS);
    expect(await noble(password, parsed?.salt as Uint8Array)).toBe(encoded.split("$").at(-1));
    // Two hashes of one password differ (fresh random salt).
    expect(await hashPassword(password)).not.toBe(encoded);
  });

  it("keeps the timing dummy a policy-strength hash no password verifies against", async () => {
    expect(isPolicyHash(TIMING_DUMMY_HASH)).toBe(true);
    expect(await verifyPassword("", TIMING_DUMMY_HASH)).toBe(false);
  });

  it("runs off the main thread: the event loop keeps ticking during concurrent hashes", async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    const started = performance.now();
    await Promise.all(Array.from({ length: 4 }, () => hashPassword("concurrency check")));
    const elapsed = performance.now() - started;
    clearInterval(timer);
    // Synchronous hashing would starve the interval completely.
    expect(ticks).toBeGreaterThan(Math.min(3, Math.floor(elapsed / 20)));
  });
});

describe("start-up self-test (§5.1 rule 3)", () => {
  it("passes with the native implementation", async () => {
    await expect(argon2SelfTest()).resolves.toBeUndefined();
  });

  it("refuses a broken or weaker implementation", async () => {
    const zeros: typeof deriveArgon2id = async (_p, _s, _params, length) => new Uint8Array(length);
    await expect(argon2SelfTest(zeros)).rejects.toThrow(/known-answer/);
    // An implementation that silently uses cheaper parameters is caught by the known answer too.
    const weaker: typeof deriveArgon2id = (p, s, _params, length) =>
      deriveArgon2id(p, s, { m: 4096, t: 1, p: 1 }, length);
    await expect(argon2SelfTest(weaker)).rejects.toThrow(/known-answer/);
    const unsupported: typeof deriveArgon2id = async () => {
      throw Object.assign(new Error("Argon2 is not supported"), {
        code: "ERR_CRYPTO_ARGON2_NOT_SUPPORTED",
      });
    };
    await expect(argon2SelfTest(unsupported)).rejects.toThrow(/not supported/);
  });
});
