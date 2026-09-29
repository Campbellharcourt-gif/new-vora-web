import { afterEach, describe, expect, it } from "vitest";
import {
  ARGON2_PARAMS,
  hashPassword,
  isPolicyHash,
  parseHash,
  TIMING_DUMMY_HASH,
  verifyPassword,
} from "~/.server/auth/password";
import {
  PASSWORD_HASHING_UNAVAILABLE,
  type PasswordHashing,
  passwordHashing,
  setPasswordHashingForTests,
} from "~/.server/auth/password-hashing";
import type { ServerContext } from "~/.server/context";
import { AppError } from "~/.server/lib/errors";

/**
 * Railway migration R2 — what password-hashing.ts does with whatever the derivation returns: only
 * policy-strength hashes are accepted, failures close with a 503, and nothing secret is ever
 * logged. On CP-3 these cases targeted the PasswordHasher Durable Object's routing (retired under
 * D23); here they target the native path, with a stand-in derivation where a failure is needed.
 */

const SECRET = "a-password-that-must-never-be-logged-2026";

function fakeCtx() {
  const logged: { level: string; event: string; fields: unknown }[] = [];
  const log = Object.fromEntries(
    ["debug", "info", "warn", "error"].map((level) => [
      level,
      (event: string, fields: unknown) => logged.push({ level, event, fields }),
    ]),
  );
  const ctx = { log } as unknown as Pick<ServerContext, "log">;
  return { ctx, logged };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

afterEach(() => setPasswordHashingForTests());

describe("policy-hash check and the timing dummy", () => {
  it("accepts only hashes made exactly like hashPassword() makes them", async () => {
    const good = await hashPassword("a sensible passphrase here");
    expect(isPolicyHash(good)).toBe(true);
    expect(isPolicyHash(good.replace("m=19456,t=2,p=1", "m=4096,t=2,p=1"))).toBe(false);
    expect(isPolicyHash(good.replace("m=19456,t=2,p=1", "m=19456,t=1,p=1"))).toBe(false);
    expect(isPolicyHash(good.replace("m=19456,t=2,p=1", "m=19456,t=2,p=2"))).toBe(false);
    expect(isPolicyHash(good.replace("$argon2id$", "$argon2i$"))).toBe(false);
    const [, , , , salt, hash] = good.split("$");
    expect(isPolicyHash(good.replace(`$${salt}$`, "$AAAAAAAAAAAA$"))).toBe(false); // short salt
    expect(isPolicyHash(good.replace(`$${hash}`, "$AAAAAAAAAAAAAAAAAAAAAA"))).toBe(false); // short output
    expect(isPolicyHash("not a hash")).toBe(false);
  });

  it("keeps the timing dummy on the current policy, and no password verifies against it", async () => {
    expect(isPolicyHash(TIMING_DUMMY_HASH)).toBe(true);
    expect(parseHash(TIMING_DUMMY_HASH)).toMatchObject(ARGON2_PARAMS);
    expect(await verifyPassword("", TIMING_DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("correct-horse-battery-staple-42", TIMING_DUMMY_HASH)).toBe(false);
  });
});

describe("native password hashing", () => {
  it("runs natively and returns the derivation's answers", async () => {
    const stored = await hashPassword(SECRET);
    const calls = { hash: [] as string[], verify: [] as [string, string][] };
    setPasswordHashingForTests({
      hash: async (p) => {
        calls.hash.push(p);
        return stored;
      },
      verify: async (p, e) => {
        calls.verify.push([p, e]);
        return e === stored;
      },
    });
    const { ctx, logged } = fakeCtx();
    const passwords: PasswordHashing = passwordHashing(ctx);
    expect(passwords.mode).toBe("native");

    expect(await passwords.hash(SECRET)).toBe(stored);
    expect(await passwords.verify(SECRET, stored)).toBe(true);
    expect(await passwords.verify(SECRET, "other")).toBe(false);
    await passwords.burn(SECRET);

    expect(calls.hash).toEqual([SECRET]);
    // burn() is one real verification against the fixed dummy — the same work as a known email.
    expect(calls.verify.at(-1)).toEqual([SECRET, TIMING_DUMMY_HASH]);
    expect(logged).toEqual([]);
  });

  it("never returns (so never stores) a hash weaker than the policy", async () => {
    const weak = (await hashPassword(SECRET)).replace("m=19456,t=2", "m=4096,t=1");
    for (const answer of [weak, "", "$argon2id$v=19$m=19456,t=2,p=1$x$y", 42, null, undefined]) {
      setPasswordHashingForTests({ hash: async () => answer as string });
      const { ctx, logged } = fakeCtx();
      const error = await rejection(passwordHashing(ctx).hash(SECRET));
      expect(error.code).toBe("service_unavailable");
      expect(logged.map((l) => l.event)).toEqual(["password_hashing_unavailable"]);
    }
  });

  it("fails closed with a 503 when Argon2 errors — no fallback", async () => {
    setPasswordHashingForTests({
      hash: async () => {
        throw new Error("ERR_CRYPTO_ARGON2_NOT_SUPPORTED (simulated)");
      },
      verify: async () => {
        throw new Error("ERR_CRYPTO_ARGON2_NOT_SUPPORTED (simulated)");
      },
    });
    const { ctx, logged } = fakeCtx();
    const passwords = passwordHashing(ctx);
    for (const attempt of [
      passwords.hash(SECRET),
      passwords.verify(SECRET, TIMING_DUMMY_HASH),
      passwords.burn(SECRET),
    ]) {
      const error = await rejection(attempt);
      expect(error.code).toBe("service_unavailable");
      expect(error.status).toBe(503);
      expect(error.publicMessage).toBe(PASSWORD_HASHING_UNAVAILABLE);
    }
    expect(logged.map((l) => `${l.level}:${l.event}`)).toEqual([
      "error:password_hashing_unavailable",
      "error:password_hashing_unavailable",
      "error:password_hashing_unavailable",
    ]);
    // What failed is logged; the password and stored hash never are.
    const text = JSON.stringify(logged);
    expect(text).toContain("ERR_CRYPTO_ARGON2_NOT_SUPPORTED");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TIMING_DUMMY_HASH);
  });

  it("treats anything but a boolean from verify() as a failure, never as a match", async () => {
    for (const answer of ["true", 1, {}, null, undefined]) {
      setPasswordHashingForTests({ verify: async () => answer as boolean });
      const { ctx } = fakeCtx();
      const error = await rejection(passwordHashing(ctx).verify(SECRET, TIMING_DUMMY_HASH));
      expect(error.code).toBe("service_unavailable");
    }
  });

  it("uses the real Argon2id end to end when nothing is overridden", async () => {
    const { ctx } = fakeCtx();
    const passwords = passwordHashing(ctx);
    const encoded = await passwords.hash(SECRET);
    expect(isPolicyHash(encoded)).toBe(true);
    expect(await passwords.verify(SECRET, encoded)).toBe(true);
    expect(await verifyPassword(SECRET, encoded)).toBe(true);
  });
});
