import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { activeOwnerExists, bootstrapOwner, isSetupAvailable } from "~/.server/auth/bootstrap";
import {
  acceptInvitation,
  createInvitation,
  getInvitationPreview,
} from "~/.server/auth/invitations";
import { emailHmac, signIn } from "~/.server/auth/login";
import {
  hashPassword,
  isPolicyHash,
  TIMING_DUMMY_HASH,
  verifyPassword,
} from "~/.server/auth/password";
import { MAX_PASSWORD_INPUT } from "~/.server/auth/password-hasher";
import { PASSWORD_HASHING_UNAVAILABLE, passwordHashing } from "~/.server/auth/password-hashing";
import {
  completePasswordReset,
  isResetTokenValid,
  requestPasswordReset,
} from "~/.server/auth/password-reset";
import type { WorkerEnv } from "~/.server/config/env";
import { AppError } from "~/.server/lib/errors";
import {
  actorFor,
  createUser,
  db,
  disableBreachCheck,
  linkFrom,
  makeCtx,
  PASSWORD,
  schema,
  sentTo,
  testEnv,
  uniqueEmail,
  uniqueIp,
} from "../support/helpers";

/**
 * CP-3 · Cloudflare Free — Argon2id in the PasswordHasher Durable Object, run in workerd with the
 * real binding from wrangler.jsonc (every other integration test hashes through it too). The
 * Durable Object's own CPU allowance on the Free plan is NOT VERIFIED here: workerd enforces no
 * CPU limits locally (docs/CLOUDFLARE-FREE-COMPATIBILITY.md).
 */

const NEW_PASSWORD = "a brand new passphrase for 2026";

/** A PASSWORD_HASHER binding whose objects always fail, as an outage or a CPU kill would. */
const failingEnv = {
  ...testEnv,
  PASSWORD_HASHER: {
    newUniqueId: () => testEnv.PASSWORD_HASHER?.newUniqueId(),
    get: () => ({
      hash: async () => {
        throw new Error("Durable Object exceeded its CPU time limit (simulated)");
      },
      verify: async () => {
        throw new Error("Durable Object exceeded its CPU time limit (simulated)");
      },
    }),
  },
} as unknown as WorkerEnv;

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

beforeAll(async () => {
  await disableBreachCheck();
});

describe("PasswordHasher Durable Object", () => {
  it("is what deployed code uses: the binding exists in every environment's configuration", () => {
    expect(testEnv.PASSWORD_HASHER).toBeDefined();
    expect(passwordHashing(makeCtx()).mode).toBe("durable_object");
  });

  it("makes the same Argon2id hashes as the in-process code, and verifies them both ways", async () => {
    const passwords = passwordHashing(makeCtx());
    const fromObject = await passwords.hash(PASSWORD);
    expect(isPolicyHash(fromObject)).toBe(true);
    expect(await verifyPassword(PASSWORD, fromObject)).toBe(true); // verified in-process
    const inProcess = await hashPassword(PASSWORD);
    expect(await passwords.verify(PASSWORD, inProcess)).toBe(true); // verified in the object
    expect(await passwords.verify(`${PASSWORD}!`, inProcess)).toBe(false);
    expect(await passwords.verify(PASSWORD, TIMING_DUMMY_HASH)).toBe(false);
    expect(await passwords.verify(PASSWORD, "not-a-hash")).toBe(false);
  });

  it("refuses oversized input without hashing it", async () => {
    const passwords = passwordHashing(makeCtx());
    const tooLong = "x".repeat(MAX_PASSWORD_INPUT + 1);
    expect((await appError(passwords.hash(tooLong))).code).toBe("service_unavailable");
    const hash = await hashPassword(PASSWORD);
    expect(await passwords.verify(PASSWORD, `${hash}${"A".repeat(300)}`)).toBe(false);
  });
});

describe("when the Durable Object is unavailable, every password flow fails closed", () => {
  it("sign-in: 503, and nothing is recorded against the account (no lockout counting)", async () => {
    const user = await createUser({ roles: ["member"] });
    const ip = uniqueIp();
    for (const email of [user.email, uniqueEmail("nobody")]) {
      const error = await appError(
        signIn(makeCtx({ ip, env: failingEnv }), { email, password: PASSWORD }),
      );
      expect(error.code).toBe("service_unavailable");
      expect(error.status).toBe(503);
      expect(error.publicMessage).toBe(PASSWORD_HASHING_UNAVAILABLE);
      const attempts = await db
        .select()
        .from(schema.loginAttempts)
        .where(eq(schema.loginAttempts.emailHmac, await emailHmac(makeCtx(), email)))
        .all();
      expect(attempts).toEqual([]);
    }
    const sessions = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id))
      .all();
    expect(sessions).toEqual([]);
    // With the object back, the same credentials sign in normally.
    expect((await signIn(makeCtx({ ip }), { email: user.email, password: PASSWORD })).kind).toBe(
      "signed_in",
    );
  });

  it("password reset: 503, and the single-use link is NOT burned", async () => {
    const user = await createUser({ roles: ["member"] });
    await requestPasswordReset(makeCtx({ ip: uniqueIp() }), user.email);
    const token = linkFrom(sentTo(user.email).at(-1)?.text ?? "", "/reset-password");
    const error = await appError(
      completePasswordReset(makeCtx({ env: failingEnv }), token, NEW_PASSWORD),
    );
    expect(error.code).toBe("service_unavailable");
    expect(await isResetTokenValid(makeCtx(), token)).toBe(true);
    const unchanged = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .get();
    expect(await verifyPassword(PASSWORD, unchanged?.passwordHash ?? "")).toBe(true);
    await completePasswordReset(makeCtx(), token, NEW_PASSWORD); // the retry still works
    expect(await isResetTokenValid(makeCtx(), token)).toBe(false);
  });

  it("invitation: 503, and the invitation is NOT claimed", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const email = uniqueEmail("invitee");
    await createInvitation(makeCtx(), admin, { email, name: "Sam", roleKeys: ["staff"] });
    const token = linkFrom(sentTo(email).at(-1)?.text ?? "", "/invite");
    const error = await appError(
      acceptInvitation(makeCtx({ env: failingEnv }), token, {
        name: "Sam Lee",
        password: NEW_PASSWORD,
      }),
    );
    expect(error.code).toBe("service_unavailable");
    expect(await getInvitationPreview(makeCtx(), token)).toMatchObject({ email });
    const users = await db.select().from(schema.users).where(eq(schema.users.email, email)).all();
    expect(users).toEqual([]);
    const accepted = await acceptInvitation(makeCtx(), token, {
      name: "Sam Lee",
      password: NEW_PASSWORD,
    });
    expect(accepted.userId).toBeTruthy();
  });

  it("first-Owner setup: 503 — not reported as an already-completed setup — and no Owner", async () => {
    const ctx = makeCtx({ ip: uniqueIp(), env: failingEnv });
    expect(await isSetupAvailable(ctx)).toBe(true);
    const error = await appError(
      bootstrapOwner(ctx, {
        setupToken: testEnv.SETUP_TOKEN ?? "",
        name: "Strive",
        email: uniqueEmail("founder"),
        password: NEW_PASSWORD,
      }),
    );
    expect(error.code).toBe("service_unavailable");
    expect(await activeOwnerExists(makeCtx())).toBe(false);
    expect(await isSetupAvailable(makeCtx())).toBe(true);
    const marker = await db
      .select()
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.key, "system.bootstrap"))
      .all();
    expect(marker).toEqual([]);
  });
});
