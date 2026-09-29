import { describe, expect, it } from "vitest";
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
} from "~/.server/auth/password-hashing";
import type { WorkerEnv } from "~/.server/config/env";
import type { ServerContext } from "~/.server/context";
import { AppError } from "~/.server/lib/errors";

/**
 * CP-3 · Cloudflare Free — routing of Argon2id to the PasswordHasher Durable Object. The object
 * itself runs in workerd (tests/integration/password-hasher.test.ts); here a stand-in namespace
 * checks what the Worker does with whatever comes back: only policy-strength hashes are accepted,
 * failures close with a 503, and nothing secret is ever logged.
 */

const SECRET = "a-password-that-must-never-be-logged-2026";

type Stub = {
  hash(password: string): Promise<unknown>;
  verify(p: string, e: string): Promise<unknown>;
};

function fakeNamespace(stub: Stub) {
  const calls = { ids: 0, hash: [] as string[], verify: [] as [string, string][] };
  const namespace = {
    newUniqueId() {
      calls.ids += 1;
      return { toString: () => `id-${calls.ids}` };
    },
    get() {
      return {
        hash: (p: string) => {
          calls.hash.push(p);
          return stub.hash(p);
        },
        verify: (p: string, e: string) => {
          calls.verify.push([p, e]);
          return stub.verify(p, e);
        },
      };
    },
  };
  return { namespace, calls };
}

function fakeCtx(namespace?: unknown) {
  const logged: { level: string; event: string; fields: unknown }[] = [];
  const log = Object.fromEntries(
    ["debug", "info", "warn", "error"].map((level) => [
      level,
      (event: string, fields: unknown) => logged.push({ level, event, fields }),
    ]),
  );
  const env = { PASSWORD_HASHER: namespace } as unknown as WorkerEnv;
  const ctx = { env, log } as unknown as Pick<ServerContext, "env" | "log">;
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

describe("password hashing routing", () => {
  it("runs in-process when no Durable Object is bound (tests, scripts)", () => {
    const { ctx } = fakeCtx(undefined);
    expect(passwordHashing(ctx).mode).toBe("in_process");
  });

  it("sends every operation to a fresh PasswordHasher object and returns its answers", async () => {
    const stored = await hashPassword(SECRET);
    const { namespace, calls } = fakeNamespace({
      hash: async () => stored,
      verify: async (_p, e) => e === stored,
    });
    const { ctx, logged } = fakeCtx(namespace);
    const passwords: PasswordHashing = passwordHashing(ctx);
    expect(passwords.mode).toBe("durable_object");

    expect(await passwords.hash(SECRET)).toBe(stored);
    expect(await passwords.verify(SECRET, stored)).toBe(true);
    expect(await passwords.verify(SECRET, "other")).toBe(false);
    await passwords.burn(SECRET);

    expect(calls.hash).toEqual([SECRET]);
    // burn() is one real verification against the fixed dummy — the same work as a known email.
    expect(calls.verify.at(-1)).toEqual([SECRET, TIMING_DUMMY_HASH]);
    expect(calls.ids).toBe(4); // a new object per operation — no shared queue
    expect(logged).toEqual([]);
  });

  it("never returns (so never stores) a hash weaker than the policy", async () => {
    const weak = (await hashPassword(SECRET)).replace("m=19456,t=2", "m=4096,t=1");
    for (const answer of [weak, "", "$argon2id$v=19$m=19456,t=2,p=1$x$y", 42, null, undefined]) {
      const { namespace } = fakeNamespace({ hash: async () => answer, verify: async () => false });
      const { ctx, logged } = fakeCtx(namespace);
      const error = await rejection(passwordHashing(ctx).hash(SECRET));
      expect(error.code).toBe("service_unavailable");
      expect(logged.map((l) => l.event)).toEqual(["password_hashing_unavailable"]);
    }
  });

  it("fails closed with a 503 when the Durable Object errors — no in-process fallback", async () => {
    const { namespace } = fakeNamespace({
      hash: async () => {
        throw new Error("Durable Object exceeded its CPU time limit");
      },
      verify: async () => {
        throw new Error("Durable Object reset because its code was updated");
      },
    });
    const { ctx, logged } = fakeCtx(namespace);
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
    expect(text).toContain("exceeded its CPU time limit");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TIMING_DUMMY_HASH);
  });

  it("treats anything but a boolean from verify() as a failure, never as a match", async () => {
    for (const answer of ["true", 1, {}, null, undefined]) {
      const { namespace } = fakeNamespace({ hash: async () => "", verify: async () => answer });
      const { ctx } = fakeCtx(namespace);
      const error = await rejection(passwordHashing(ctx).verify(SECRET, TIMING_DUMMY_HASH));
      expect(error.code).toBe("service_unavailable");
    }
  });
});
