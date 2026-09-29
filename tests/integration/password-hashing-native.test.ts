import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
import {
  MAX_PASSWORD_INPUT,
  PASSWORD_HASHING_UNAVAILABLE,
  passwordHashing,
  passwordHashingLoad,
  setPasswordHashingForTests,
} from "~/.server/auth/password-hashing";
import {
  completePasswordReset,
  isResetTokenValid,
  requestPasswordReset,
} from "~/.server/auth/password-reset";
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
 * Railway migration R2 — Argon2id in-process through Node's native `crypto.argon2`, replacing
 * CP-3's PasswordHasher Durable Object (tests/integration/password-hasher.test.ts on the CP-3
 * branch, retired under D23). Every scenario of that file is kept here against the native path:
 * the same hashes, the refusal of oversized input, and the fail-closed behaviour of every password
 * flow when hashing is unavailable — now caused by an Argon2 error or a full queue instead of an
 * unreachable object. Every other integration test hashes natively too.
 */

const NEW_PASSWORD = "a brand new passphrase for 2026";

/** Hashing that always fails, as an OpenSSL error or an exhausted queue would. */
function breakHashing() {
  const fail = async () => {
    throw new Error("argon2 derivation failed (simulated)");
  };
  setPasswordHashingForTests({ hash: fail, verify: fail });
}

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

afterEach(() => setPasswordHashingForTests());

describe("native Argon2id", () => {
  it("is what the application uses", () => {
    expect(passwordHashing(makeCtx()).mode).toBe("native");
  });

  it("makes policy-strength hashes that verify both ways against the plain functions", async () => {
    const passwords = passwordHashing(makeCtx());
    const fromLimiter = await passwords.hash(PASSWORD);
    expect(isPolicyHash(fromLimiter)).toBe(true);
    expect(await verifyPassword(PASSWORD, fromLimiter)).toBe(true);
    const direct = await hashPassword(PASSWORD);
    expect(await passwords.verify(PASSWORD, direct)).toBe(true);
    expect(await passwords.verify(`${PASSWORD}!`, direct)).toBe(false);
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

describe("when hashing is unavailable, every password flow fails closed", () => {
  it("sign-in: 503, and nothing is recorded against the account (no lockout counting)", async () => {
    const user = await createUser({ roles: ["member"] });
    const ip = uniqueIp();
    breakHashing();
    for (const email of [user.email, uniqueEmail("nobody")]) {
      const error = await appError(signIn(makeCtx({ ip }), { email, password: PASSWORD }));
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
    // With hashing back, the same credentials sign in normally.
    setPasswordHashingForTests();
    expect((await signIn(makeCtx({ ip }), { email: user.email, password: PASSWORD })).kind).toBe(
      "signed_in",
    );
  });

  it("password reset: 503, and the single-use link is NOT burned", async () => {
    const user = await createUser({ roles: ["member"] });
    await requestPasswordReset(makeCtx({ ip: uniqueIp() }), user.email);
    const token = linkFrom(sentTo(user.email).at(-1)?.text ?? "", "/reset-password");
    breakHashing();
    const error = await appError(completePasswordReset(makeCtx(), token, NEW_PASSWORD));
    expect(error.code).toBe("service_unavailable");
    setPasswordHashingForTests();
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
    breakHashing();
    const error = await appError(
      acceptInvitation(makeCtx(), token, { name: "Sam Lee", password: NEW_PASSWORD }),
    );
    expect(error.code).toBe("service_unavailable");
    setPasswordHashingForTests();
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
    const ctx = makeCtx({ ip: uniqueIp() });
    expect(await isSetupAvailable(ctx)).toBe(true);
    breakHashing();
    const error = await appError(
      bootstrapOwner(ctx, {
        setupToken: testEnv.SETUP_TOKEN ?? "",
        name: "Strive",
        email: uniqueEmail("founder"),
        password: NEW_PASSWORD,
      }),
    );
    expect(error.code).toBe("service_unavailable");
    setPasswordHashingForTests();
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

describe("back-pressure (at most 4 hashes at once, a short queue, then 503)", () => {
  it("a sign-in refused by a full queue answers 503 and records no attempt", async () => {
    const user = await createUser({ roles: ["member"] });
    // One slot, no queue, and a derivation that holds its slot until released.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPasswordHashingForTests({
      limit: 1,
      queueLimit: 0,
      verify: async (password, encoded) => {
        await held;
        return verifyPassword(password, encoded);
      },
    });
    const first = signIn(makeCtx({ ip: uniqueIp() }), { email: user.email, password: PASSWORD });
    await new Promise((r) => setTimeout(r, 20));
    expect(passwordHashingLoad().active).toBe(1);

    const refused = await appError(
      signIn(makeCtx({ ip: uniqueIp() }), { email: user.email, password: PASSWORD }),
    );
    expect(refused.code).toBe("service_unavailable");
    expect(refused.status).toBe(503);
    release();
    expect((await first).kind).toBe("signed_in");
    // Only the sign-in that ran is recorded; the refused one left nothing behind.
    const attempts = await db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.emailHmac, await emailHmac(makeCtx(), user.email)))
      .all();
    expect(attempts).toHaveLength(1);
  });

  it("a wait longer than the queue timeout also answers 503", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPasswordHashingForTests({
      limit: 1,
      queueLimit: 4,
      timeoutMs: 50,
      hash: async (password) => {
        await held;
        return hashPassword(password);
      },
    });
    const passwords = passwordHashing(makeCtx());
    const first = passwords.hash(NEW_PASSWORD);
    const waited = await appError(passwords.hash(NEW_PASSWORD));
    expect(waited.code).toBe("service_unavailable");
    release();
    expect(isPolicyHash(await first)).toBe(true);
    expect(passwordHashingLoad()).toEqual({ active: 0, queued: 0 });
  });
});
