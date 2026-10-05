import { registrationSchema } from "@shared/validation/auth";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { elevate, setTwoStep } from "~/.server/auth/account";
import {
  acceptInvitation,
  createInvitation,
  getInvitationPreview,
} from "~/.server/auth/invitations";
import { signIn } from "~/.server/auth/login";
import { loadUserAccess } from "~/.server/auth/rbac";
import { REGISTRATION_POLICY, startRegistration } from "~/.server/auth/registration";
import { AppError } from "~/.server/lib/errors";
import {
  actorFor,
  createUser,
  db,
  disableBreachCheck,
  linkFrom,
  makeCtx,
  PASSWORD,
  resetCaches,
  schema,
  sentTo,
  setFlag,
  uniqueEmail,
  uniqueIp,
} from "../support/helpers";

/**
 * Public Client/Member registration: two steps (details → emailed link → password), so only the
 * owner of the address can ever set a password; identical answers whether or not the address
 * has an account; Owner/Admin/Staff can never be self-assigned.
 */

const NEW_PASSWORD = "a brand new passphrase for 2026";

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

function verifyToken(email: string): string {
  const mail = sentTo(email)
    .filter((m) => m.subject === "Confirm your email for VORA")
    .at(-1);
  if (!mail) throw new Error(`No verification email for ${email}`);
  return linkFrom(mail.text, "/verify-email");
}

beforeAll(async () => {
  await disableBreachCheck();
});
beforeEach(async () => {
  resetCaches();
  await setFlag("accounts.self_signup", true);
});

describe("registration — step 1 (details)", () => {
  it("only Client and Member can be chosen; Owner, Admin and Staff are rejected", () => {
    const base = { name: "Pat Client", email: "pat@example.test", consent: "on" };
    expect(registrationSchema.safeParse({ ...base, accountType: "client" }).success).toBe(true);
    expect(registrationSchema.safeParse({ ...base, accountType: "member" }).success).toBe(true);
    for (const accountType of ["owner", "admin", "manager", "staff", ""]) {
      expect(registrationSchema.safeParse({ ...base, accountType }).success, accountType).toBe(
        false,
      );
    }
    expect(
      registrationSchema.safeParse({ ...base, accountType: "client", consent: "" }).success,
    ).toBe(false);
  });

  it("emails a single-use confirmation link and creates no account yet", async () => {
    const email = uniqueEmail("reg");
    await startRegistration(makeCtx(), { accountType: "client", name: "Pat", email });
    expect(verifyToken(email)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    expect(user).toBeUndefined();
    const pending = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, email))
      .all();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.invitedBy).toBeNull();
    expect(pending[0]?.roleKeys).toEqual(["client"]);
  });

  it("an address with an account gets a sign-in reminder instead, and nothing changes", async () => {
    const existing = await createUser({ roles: ["member"] });
    const ctx = makeCtx();
    await startRegistration(ctx, { accountType: "client", name: "Someone", email: existing.email });
    await ctx.flush();
    const mails = sentTo(existing.email);
    expect(mails.map((m) => m.subject)).toContain("You already have a VORA account");
    expect(mails.map((m) => m.subject)).not.toContain("Confirm your email for VORA");
    const invitations = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.email, existing.email))
      .all();
    expect(invitations).toHaveLength(0);
    expect((await loadUserAccess(db, existing.id)).roles).toEqual(["member"]);
  });

  it("only the newest link works, and links per address are capped per hour", async () => {
    const email = uniqueEmail("reg");
    await startRegistration(makeCtx(), { accountType: "member", name: "A", email });
    const first = verifyToken(email);
    await startRegistration(makeCtx(), { accountType: "member", name: "A", email });
    const second = verifyToken(email);
    expect(second).not.toBe(first);
    expect(await getInvitationPreview(makeCtx(), first)).toBeNull();
    expect((await getInvitationPreview(makeCtx(), second))?.selfRegistration).toBe(true);

    for (let i = 2; i < REGISTRATION_POLICY.maxPerEmailPerHour; i++) {
      await startRegistration(makeCtx(), { accountType: "member", name: "A", email });
    }
    const before = sentTo(email).length;
    await startRegistration(makeCtx(), { accountType: "member", name: "A", email });
    expect(sentTo(email).length).toBe(before);
  });

  it("does nothing while registration is switched off", async () => {
    await setFlag("accounts.self_signup", false);
    const email = uniqueEmail("reg");
    await startRegistration(makeCtx(), { accountType: "client", name: "B", email });
    expect(sentTo(email)).toHaveLength(0);
  });
});

describe("registration — step 2 (confirm and set a password)", () => {
  it("creates an active, verified account with exactly the chosen role and signs in", async () => {
    const owner = await createUser({ roles: ["owner"] });
    const manager = await createUser({ roles: ["manager"] }); // holds clients.manage
    const email = uniqueEmail("reg");
    await startRegistration(makeCtx(), { accountType: "client", name: "Casey", email });
    const accepted = await acceptInvitation(
      makeCtx(),
      verifyToken(email),
      { name: "Casey Client", password: NEW_PASSWORD },
      { selfRegistration: true },
    );
    const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    expect(user?.status).toBe("active");
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.name).toBe("Casey Client");
    const access = await loadUserAccess(db, accepted.userId);
    expect(access.roles).toEqual(["client"]);
    expect(access.privileged).toBe(false);
    expect(access.permissions.has("admin.access")).toBe(false);
    expect(accepted.recoveryCodes).toBeNull();

    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "user.register"),
          eq(schema.auditLogs.targetId, accepted.userId),
        ),
      )
      .get();
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);

    // People who can link client accounts to organisations are told about it.
    for (const id of [owner.id, manager.id]) {
      const notes = await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, id),
            eq(schema.notifications.type, "client.registered"),
          ),
        )
        .all();
      expect(notes.some((n) => n.link === `/admin/users/${accepted.userId}`)).toBe(true);
    }

    // The link works once.
    expect(
      (
        await appError(
          acceptInvitation(
            makeCtx(),
            verifyToken(email),
            { name: "Again", password: NEW_PASSWORD },
            { selfRegistration: true },
          ),
        )
      ).code,
    ).toBe("validation_failed");

    // And the new account signs in with the password chosen at step 2.
    const result = await signIn(makeCtx({ ip: uniqueIp() }), { email, password: NEW_PASSWORD });
    expect(result.kind).toBe("signed_in");
  });

  it("applies the password policy", async () => {
    const email = uniqueEmail("reg");
    await startRegistration(makeCtx(), { accountType: "member", name: "Dee", email });
    const error = await appError(
      acceptInvitation(
        makeCtx(),
        verifyToken(email),
        { name: "Dee", password: "short" },
        { selfRegistration: true },
      ),
    );
    expect(error.code).toBe("validation_failed");
  });

  it("the confirmation page never completes an invitation sent by VORA (no role escalation)", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const email = uniqueEmail("staff");
    await createInvitation(makeCtx(), admin, { email, roleKeys: ["staff"] });
    const mail = sentTo(email).at(-1);
    const token = linkFrom(mail?.text ?? "", "/invite");
    expect((await getInvitationPreview(makeCtx(), token))?.selfRegistration).toBe(false);
    const error = await appError(
      acceptInvitation(
        makeCtx(),
        token,
        { name: "X", password: NEW_PASSWORD },
        { selfRegistration: true },
      ),
    );
    expect(error.code).toBe("validation_failed");
    const user = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .get();
    expect(user).toBeUndefined();
  });
});

describe("optional two-step verification for Clients and Members", () => {
  it("needs a password confirmation, then makes sign-in ask for an emailed code", async () => {
    const client = await createUser({ roles: ["client"] });
    const actor = await actorFor(client.id);
    expect((await appError(setTwoStep(makeCtx(), actor, true))).code).toBe("validation_failed");
    await elevate(makeCtx(), actor, PASSWORD);
    const elevated = await actorFor(client.id, { elevated: true });
    const { recoveryCodes } = await setTwoStep(makeCtx(), elevated, true);
    expect(recoveryCodes).toHaveLength(10);
    const row = await db.select().from(schema.users).where(eq(schema.users.id, client.id)).get();
    expect(row?.mfaEnforced).toBe(true);
    const result = await signIn(makeCtx({ ip: uniqueIp() }), {
      email: client.email,
      password: PASSWORD,
    });
    expect(result.kind).toBe("mfa_required");
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.targetId, client.id),
          eq(schema.auditLogs.action, "user.two_step.enable"),
        ),
      )
      .get();
    expect(audit).toBeDefined();
  });

  it("privileged roles can't turn it off", async () => {
    const staff = await createUser({ roles: ["staff"] });
    const actor = await actorFor(staff.id, { elevated: true });
    expect((await appError(setTwoStep(makeCtx(), actor, false))).code).toBe("conflict");
  });
});
