import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  changePassword,
  elevate,
  regenerateRecoveryCodes,
  revokeOwnSession,
} from "~/.server/auth/account";
import { activeOwnerExists, bootstrapOwner, isSetupAvailable } from "~/.server/auth/bootstrap";
import {
  acceptInvitation,
  createInvitation,
  getInvitationPreview,
} from "~/.server/auth/invitations";
import { signIn } from "~/.server/auth/login";
import { consumeRecoveryCode, generateRecoveryCodes } from "~/.server/auth/mfa";
import { verifyPassword } from "~/.server/auth/password";
import {
  completePasswordReset,
  isResetTokenValid,
  requestPasswordReset,
} from "~/.server/auth/password-reset";
import { resolveSession } from "~/.server/auth/sessions";
import type { Actor } from "~/.server/auth/types";
import { sha256Hex } from "~/.server/lib/crypto";
import { AppError } from "~/.server/lib/errors";
import { newId } from "~/.server/lib/ids";
import {
  actorFor,
  call,
  createUser,
  db,
  disableBreachCheck,
  linkFrom,
  makeCtx,
  manualClock,
  PASSWORD,
  SAME_ORIGIN,
  schema,
  sentTo,
  signedInSession,
  testEnv,
  uniqueEmail,
  uniqueIp,
  withCookie,
} from "../support/helpers";

const MINUTE = 60_000;
const NEW_PASSWORD = "a brand new passphrase for 2026";

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

async function reresolve(token: string, clock?: { now(): number }): Promise<Actor> {
  const resolved = await resolveSession(makeCtx(clock ? { clock } : {}), withCookie(token));
  if (resolved.kind !== "full") throw new Error(resolved.kind);
  return resolved.actor;
}

beforeAll(async () => {
  await disableBreachCheck();
});

// Runs first: nothing in this file creates an Owner before the bootstrap test.
describe("owner bootstrap (/setup)", () => {
  it("is guarded by the setup token and closes permanently after the first Owner", async () => {
    const ctx = makeCtx({ ip: uniqueIp() });
    expect(await activeOwnerExists(ctx)).toBe(false);
    expect(await isSetupAvailable(ctx)).toBe(true);
    const email = uniqueEmail("founder");

    const wrong = await appError(
      bootstrapOwner(ctx, {
        setupToken: "not-the-token-0123456789",
        name: "Strive",
        email,
        password: NEW_PASSWORD,
      }),
    );
    expect(wrong.code).toBe("forbidden");
    const rejected = await db
      .select()
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.type, "auth.setup.rejected"))
      .all();
    expect(rejected).toHaveLength(1);

    const setupToken = testEnv.SETUP_TOKEN ?? "";
    const weak = await appError(
      bootstrapOwner(ctx, { setupToken, name: "Strive", email, password: "password1234" }),
    );
    expect(weak.code).toBe("validation_failed");

    const created = await bootstrapOwner(ctx, {
      setupToken,
      name: "Strive",
      email,
      password: NEW_PASSWORD,
    });
    expect(created.recoveryCodes).toHaveLength(10);
    const owner = await reresolve(created.session.token);
    expect(owner.roles).toEqual(["owner"]);
    expect(owner.permissions.has("roles.manage")).toBe(true);
    expect(owner.session.mfaVerifiedAt).not.toBeNull();
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "system.bootstrap"))
      .all();
    expect(audit).toHaveLength(1);

    expect(await isSetupAvailable(ctx)).toBe(false);
    const again = await appError(
      bootstrapOwner(ctx, {
        setupToken,
        name: "Mallory",
        email: uniqueEmail("x"),
        password: NEW_PASSWORD,
      }),
    );
    expect(again.code).toBe("not_found");
  });
});

describe("password reset", () => {
  it("answers identically for unknown, suspended and active accounts and emails only active ones", async () => {
    const ip = uniqueIp();
    const active = await createUser({ roles: ["member"] });
    const suspended = await createUser({ roles: ["member"], status: "suspended" });
    await expect(
      requestPasswordReset(makeCtx({ ip }), uniqueEmail("nobody")),
    ).resolves.toBeUndefined();
    await expect(requestPasswordReset(makeCtx({ ip }), suspended.email)).resolves.toBeUndefined();
    await expect(
      requestPasswordReset(makeCtx({ ip }), active.email.toUpperCase()),
    ).resolves.toBeUndefined();
    expect(sentTo(suspended.email)).toHaveLength(0);
    const mail = sentTo(active.email).at(-1);
    expect(mail?.subject).toBe("Reset your VORA password");
    const token = linkFrom(mail?.text ?? "", "/reset-password");

    const tokens = await db
      .select()
      .from(schema.authTokens)
      .where(eq(schema.authTokens.userId, active.id))
      .all();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tokenHash).toBe(await sha256Hex(token));
    expect(JSON.stringify(tokens)).not.toContain(token);
    const outbox = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.toEmail, active.email))
      .all();
    expect(outbox[0]).toMatchObject({ sensitive: true, payload: { redacted: true } });
    expect(JSON.stringify(outbox)).not.toContain(token);
  });

  it("completes once: policy enforced, every session revoked, lock cleared, holder alerted", async () => {
    const ip = uniqueIp();
    const user = await createUser({ roles: ["member"] });
    const s1 = await signedInSession(user.id);
    const s2 = await signedInSession(user.id);
    await db
      .update(schema.users)
      .set({ lockedUntil: Date.now() + 10 * MINUTE })
      .where(eq(schema.users.id, user.id));
    await requestPasswordReset(makeCtx({ ip }), user.email);
    const token = linkFrom(sentTo(user.email).at(-1)?.text ?? "", "/reset-password");

    const weak = await appError(completePasswordReset(makeCtx({ ip }), token, "short"));
    expect(weak.fields).toHaveProperty("password");
    expect(await isResetTokenValid(makeCtx(), token)).toBe(true); // a failed attempt doesn't burn it

    const ctx = makeCtx({ ip });
    await completePasswordReset(ctx, token, NEW_PASSWORD);
    await ctx.flush();
    const updated = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    expect(await verifyPassword(NEW_PASSWORD, updated?.passwordHash ?? "")).toBe(true);
    expect(await verifyPassword(PASSWORD, updated?.passwordHash ?? "")).toBe(false);
    expect(updated?.lockedUntil).toBeNull();
    for (const s of [s1, s2]) {
      const row = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, s.sessionId))
        .get();
      expect(row?.revokedReason).toBe("password_reset");
    }
    expect(sentTo(user.email).map((m) => m.subject)).toContain(
      "Security notice: Your password was changed",
    );

    const reused = await appError(
      completePasswordReset(makeCtx({ ip }), token, "another passphrase 2026"),
    );
    expect(reused.code).toBe("validation_failed");
    expect((await signIn(makeCtx({ ip }), { email: user.email, password: PASSWORD })).kind).toBe(
      "error",
    );
    expect(
      (await signIn(makeCtx({ ip }), { email: user.email, password: NEW_PASSWORD })).kind,
    ).toBe("signed_in");
  });

  it("expires links after 30 minutes and invalidates older links", async () => {
    const ip = uniqueIp();
    const clock = manualClock();
    const user = await createUser({ roles: ["member"] });
    await requestPasswordReset(makeCtx({ ip, clock }), user.email);
    const first = linkFrom(sentTo(user.email).at(-1)?.text ?? "", "/reset-password");
    clock.advance(1000);
    await requestPasswordReset(makeCtx({ ip, clock }), user.email);
    const second = linkFrom(sentTo(user.email).at(-1)?.text ?? "", "/reset-password");
    expect(second).not.toBe(first);
    expect(await isResetTokenValid(makeCtx({ clock }), first)).toBe(false);
    expect(await isResetTokenValid(makeCtx({ clock }), second)).toBe(true);
    clock.advance(31 * MINUTE);
    expect(await isResetTokenValid(makeCtx({ clock }), second)).toBe(false);
  });

  it("sends at most three reset emails per account per hour", async () => {
    const user = await createUser({ roles: ["member"] });
    for (let i = 0; i < 5; i++) await requestPasswordReset(makeCtx({ ip: uniqueIp() }), user.email);
    expect(sentTo(user.email)).toHaveLength(3);
  });
});

describe("invitations", () => {
  it("lets a Manager invite Staff but never peers or superiors", async () => {
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id);
    const ctx = makeCtx({ ip: uniqueIp() });
    const email = uniqueEmail("newstaff");
    await createInvitation(ctx, manager, { email, roleKeys: ["staff"] });
    const mail = sentTo(email).at(-1);
    expect(mail?.subject).toBe("Your invitation to VORA");
    expect(mail?.text).toContain("as Staff");
    for (const role of ["manager", "admin", "owner"]) {
      const denied = await appError(
        createInvitation(ctx, manager, { email: uniqueEmail(), roleKeys: [role] }),
      );
      expect(denied.code, role).toBe("forbidden");
    }
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    expect(
      (await appError(createInvitation(ctx, staff, { email: uniqueEmail(), roleKeys: ["member"] })))
        .code,
    ).toBe("forbidden");
    const existing = await createUser({ roles: ["member"] });
    expect(
      (
        await appError(
          createInvitation(ctx, manager, { email: existing.email, roleKeys: ["staff"] }),
        )
      ).code,
    ).toBe("conflict");
    expect(
      (
        await appError(
          createInvitation(ctx, manager, { email: uniqueEmail(), roleKeys: ["wizard"] }),
        )
      ).code,
    ).toBe("validation_failed");
    expect(
      (await appError(createInvitation(ctx, null, { email: uniqueEmail(), roleKeys: ["staff"] })))
        .code,
    ).toBe("unauthenticated");
  });

  it("creates a verified account with its roles and one-time recovery codes for privileged roles", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const email = uniqueEmail("newmanager");
    const { invitationId } = await createInvitation(makeCtx(), admin, {
      email,
      name: "Riley",
      roleKeys: ["manager"],
    });
    const token = linkFrom(sentTo(email).at(-1)?.text ?? "", "/invite");
    expect(await getInvitationPreview(makeCtx(), token)).toMatchObject({
      email,
      roleKeys: ["manager"],
    });

    const accepted = await acceptInvitation(makeCtx(), token, {
      name: "Riley Chen",
      password: NEW_PASSWORD,
    });
    expect(accepted.recoveryCodes).toHaveLength(10);
    const actor = await reresolve(accepted.session.token);
    expect(actor.roles).toEqual(["manager"]);
    expect(actor.privileged).toBe(true);
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, accepted.userId))
      .get();
    expect(user).toMatchObject({ email, name: "Riley Chen", status: "active" });
    expect(user?.emailVerifiedAt).not.toBeNull();
    const invitation = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitationId))
      .get();
    expect(invitation?.acceptedUserId).toBe(accepted.userId);
    expect(JSON.stringify(invitation)).not.toContain(token);

    const replay = await appError(
      acceptInvitation(makeCtx(), token, { name: "X", password: NEW_PASSWORD }),
    );
    expect(replay.code).toBe("validation_failed");
  });

  it("links client invitees to their organisation without recovery codes", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const now = Date.now();
    const orgId = newId("clientOrg", now);
    await db
      .insert(schema.clientOrgs)
      .values({ id: orgId, name: "Northwind", slug: "northwind", createdAt: now, updatedAt: now });
    const email = uniqueEmail("client");
    await createInvitation(makeCtx(), admin, { email, roleKeys: ["client"], clientOrgId: orgId });
    const token = linkFrom(sentTo(email).at(-1)?.text ?? "", "/invite");
    const accepted = await acceptInvitation(makeCtx(), token, {
      name: "Casey",
      password: NEW_PASSWORD,
    });
    expect(accepted.recoveryCodes).toBeNull();
    const membership = await db
      .select()
      .from(schema.clientOrgMembers)
      .where(
        and(
          eq(schema.clientOrgMembers.orgId, orgId),
          eq(schema.clientOrgMembers.userId, accepted.userId),
        ),
      )
      .get();
    expect(membership).toBeDefined();
    const unknownOrg = await appError(
      createInvitation(makeCtx(), admin, {
        email: uniqueEmail(),
        roleKeys: ["client"],
        clientOrgId: "org_missing",
      }),
    );
    expect(unknownOrg.code).toBe("validation_failed");
  });

  it("rejects weak passwords without burning the invitation, and expires after 72 hours", async () => {
    const clock = manualClock();
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const email = uniqueEmail("late");
    await createInvitation(makeCtx({ clock }), admin, { email, roleKeys: ["staff"] });
    const token = linkFrom(sentTo(email).at(-1)?.text ?? "", "/invite");
    const weak = await appError(
      acceptInvitation(makeCtx({ clock }), token, { name: "Late", password: "password1234" }),
    );
    expect(weak.fields).toHaveProperty("password");
    expect(await getInvitationPreview(makeCtx({ clock }), token)).not.toBeNull();
    clock.advance(73 * 60 * MINUTE);
    const expired = await appError(
      acceptInvitation(makeCtx({ clock }), token, { name: "Late", password: NEW_PASSWORD }),
    );
    expect(expired.code).toBe("validation_failed");
  });
});

describe("account self-service", () => {
  it("changes the password and signs out every other session", async () => {
    const user = await createUser({ roles: ["member"] });
    const actor = await actorFor(user.id);
    const other = await signedInSession(user.id);
    const ctx = makeCtx({ ip: uniqueIp() });

    const wrong = await appError(
      changePassword(ctx, actor, { currentPassword: "nope-nope-nope", newPassword: NEW_PASSWORD }),
    );
    expect(wrong.fields).toHaveProperty("currentPassword");
    const same = await appError(
      changePassword(ctx, actor, { currentPassword: PASSWORD, newPassword: PASSWORD }),
    );
    expect(same.fields).toHaveProperty("newPassword");

    await changePassword(ctx, actor, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    await ctx.flush();
    const otherRow = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, other.sessionId))
      .get();
    expect(otherRow?.revokedReason).toBe("password_changed");
    expect((await reresolve(actor.token)).userId).toBe(user.id); // current session survives
    expect(sentTo(user.email).map((m) => m.subject)).toContain(
      "Security notice: Your password was changed",
    );
  });

  it("requires a fresh step-up to regenerate recovery codes, which voids the old set", async () => {
    const user = await createUser({ roles: ["staff"] });
    const oldCodes = await generateRecoveryCodes(makeCtx(), user.id);
    const actor = await actorFor(user.id);
    expect((await appError(regenerateRecoveryCodes(makeCtx(), actor))).code).toBe(
      "validation_failed",
    );
    expect((await appError(elevate(makeCtx(), actor, "wrong-password-123"))).fields).toHaveProperty(
      "password",
    );

    await elevate(makeCtx(), actor, PASSWORD);
    const elevated = await reresolve(actor.token);
    const fresh = await regenerateRecoveryCodes(makeCtx(), elevated);
    expect(fresh).toHaveLength(10);
    expect(await consumeRecoveryCode(makeCtx(), user.id, oldCodes[0] ?? "")).toBe(false);
    expect(await consumeRecoveryCode(makeCtx(), user.id, fresh[0] ?? "")).toBe(true);

    // Step-up lasts ten minutes.
    const clock = manualClock(Date.now() + 11 * MINUTE);
    const later = await reresolve(actor.token, clock);
    expect((await appError(regenerateRecoveryCodes(makeCtx({ clock }), later))).code).toBe(
      "validation_failed",
    );
  });

  it("revokes only the user's own sessions (service and API)", async () => {
    const alice = await actorFor((await createUser({ roles: ["member"] })).id);
    const aliceOther = await signedInSession(alice.userId);
    const bob = await createUser({ roles: ["member"] });
    const bobSession = await signedInSession(bob.id);

    expect((await appError(revokeOwnSession(makeCtx(), alice, bobSession.sessionId))).code).toBe(
      "not_found",
    );
    expect((await appError(revokeOwnSession(makeCtx(), alice, "not-a-session-id"))).code).toBe(
      "not_found",
    );

    const list = await call("/api/v1/account/sessions", { token: alice.token });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { sessions: { id: string; current: boolean }[] };
    expect(body.sessions.map((s) => s.id).sort()).toEqual(
      [alice.session.id, aliceOther.sessionId].sort(),
    );
    expect(body.sessions.find((s) => s.current)?.id).toBe(alice.session.id);
    expect(JSON.stringify(body)).not.toMatch(/token|ipHash|deviceHash/);

    const denied = await call(`/api/v1/account/sessions/${bobSession.sessionId}`, {
      method: "DELETE",
      token: alice.token,
      headers: SAME_ORIGIN,
    });
    expect(denied.status).toBe(404);
    const bobRow = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, bobSession.sessionId))
      .get();
    expect(bobRow?.revokedAt).toBeNull();

    const ok = await call(`/api/v1/account/sessions/${aliceOther.sessionId}`, {
      method: "DELETE",
      token: alice.token,
      headers: SAME_ORIGIN,
    });
    expect(ok.status).toBe(204);

    const third = await signedInSession(alice.userId);
    const others = await call("/api/v1/account/sessions/revoke-others", {
      method: "POST",
      token: alice.token,
      headers: SAME_ORIGIN,
    });
    expect(await others.json()).toEqual({ revoked: 1 });
    const thirdRow = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, third.sessionId))
      .get();
    expect(thirdRow?.revokedReason).toBe("revoked_by_user");
    expect((await call("/api/v1/account/sessions", {})).status).toBe(401);
  });
});
