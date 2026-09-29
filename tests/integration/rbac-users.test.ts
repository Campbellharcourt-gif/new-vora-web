import { DEFAULT_ROLES } from "@shared/permissions";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authorize, loadUserAccess } from "~/.server/auth/rbac";
import { AppError } from "~/.server/lib/errors";
import { listUsers, setUserRoles, setUserStatus } from "~/.server/services/users";
import { actorFor, createUser, db, makeCtx, schema, signedInSession } from "../support/helpers";

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

async function rolesOf(userId: string) {
  return (await loadUserAccess(db, userId)).roles;
}

describe("effective permissions", () => {
  it("resolves every system role's permissions from the database", async () => {
    for (const role of DEFAULT_ROLES) {
      const user = await createUser({ roles: [role.key] });
      const access = await loadUserAccess(db, user.id);
      expect([...access.permissions].sort(), role.key).toEqual([...role.permissions].sort());
      expect(access.rank).toBe(role.rank);
      expect(access.privileged).toBe(role.privileged);
    }
  });

  it("unions permissions across roles and takes the highest rank", async () => {
    const user = await createUser({ roles: ["staff", "client"] });
    const access = await loadUserAccess(db, user.id);
    expect(access.roles).toEqual(["client", "staff"]);
    expect(access.permissions.has("admin.access")).toBe(true);
    expect(access.permissions.has("client_portal.access")).toBe(true);
    expect(access.rank).toBe(40);
    expect(access.privileged).toBe(true);
  });

  it("authorize() separates anonymous, forbidden and allowed, and records denials", async () => {
    const ctx = makeCtx();
    expect((await appError(authorize(ctx, null, "enquiries.view"))).code).toBe("unauthenticated");
    const member = await actorFor((await createUser({ roles: ["member"] })).id);
    expect((await appError(authorize(ctx, member, "enquiries.view"))).code).toBe("forbidden");
    const denials = await db
      .select()
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.userId, member.userId))
      .all();
    expect(denials.map((d) => d.type)).toEqual(["authz.denied"]);
    expect(denials[0]?.details).toEqual({ permission: "enquiries.view" });
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    expect(await authorize(ctx, staff, "enquiries.view")).toBe(staff);
  });

  it("lists users only for holders of users.view", async () => {
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id);
    const rows = await listUsers(makeCtx(), manager);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0] ?? {})).not.toContain("passwordHash");
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    expect((await appError(listUsers(makeCtx(), staff))).code).toBe("forbidden");
  });
});

describe("role assignment", () => {
  it("requires roles.assign and a fresh step-up, then re-authenticates the target", async () => {
    const target = await createUser({ roles: ["member"] });
    const targetSession = await signedInSession(target.id);
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id, {
      elevated: true,
    });
    expect((await appError(setUserRoles(makeCtx(), manager, target.id, ["staff"]))).code).toBe(
      "forbidden",
    );

    const adminId = (await createUser({ roles: ["admin"] })).id;
    const notElevated = await actorFor(adminId);
    expect((await appError(setUserRoles(makeCtx(), notElevated, target.id, ["staff"]))).code).toBe(
      "validation_failed",
    );

    const admin = await actorFor(adminId, { elevated: true });
    await setUserRoles(makeCtx(), admin, target.id, ["staff"]);
    expect(await rolesOf(target.id)).toEqual(["staff"]);
    const session = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, targetSession.sessionId))
      .get();
    expect(session?.revokedReason).toBe("roles_changed");
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, target.id))
      .all();
    expect(audit.map((a) => a.action)).toContain("user.roles.set");
    expect(audit[0]?.actorUserId).toBe(adminId);
  });

  it("never grants equal or higher roles, touches higher-ranked users, or edits oneself", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id, { elevated: true });
    const member = await createUser({ roles: ["member"] });
    for (const role of ["admin", "owner"]) {
      expect((await appError(setUserRoles(makeCtx(), admin, member.id, [role]))).code, role).toBe(
        "forbidden",
      );
    }
    const owner = await createUser({ roles: ["owner"] });
    expect((await appError(setUserRoles(makeCtx(), admin, owner.id, ["member"]))).code).toBe(
      "forbidden",
    );
    const peer = await createUser({ roles: ["admin"] });
    expect((await appError(setUserRoles(makeCtx(), admin, peer.id, ["staff"]))).code).toBe(
      "forbidden",
    );
    expect((await appError(setUserRoles(makeCtx(), admin, admin.userId, ["owner"]))).code).toBe(
      "forbidden",
    );
    expect(await rolesOf(member.id)).toEqual(["member"]);
    expect(await rolesOf(owner.id)).toEqual(["owner"]);
    expect((await appError(setUserRoles(makeCtx(), admin, "usr_nope", ["member"]))).code).toBe(
      "not_found",
    );
    expect((await appError(setUserRoles(makeCtx(), admin, member.id, ["nonexistent"]))).code).toBe(
      "validation_failed",
    );
  });

  it("lets Owners grant and remove Owner for others, never for themselves", async () => {
    const ownerA = await actorFor((await createUser({ roles: ["owner"] })).id, { elevated: true });
    const ownerB = await createUser({ roles: ["owner"] });
    const candidate = await createUser({ roles: ["admin"] });
    await setUserRoles(makeCtx(), ownerA, candidate.id, ["owner"]);
    expect(await rolesOf(candidate.id)).toEqual(["owner"]);
    await setUserRoles(makeCtx(), ownerA, ownerB.id, ["admin"]);
    expect(await rolesOf(ownerB.id)).toEqual(["admin"]);
    expect((await appError(setUserRoles(makeCtx(), ownerA, ownerA.userId, ["admin"]))).code).toBe(
      "forbidden",
    );
  });
});

describe("suspension", () => {
  it("suspends lower-ranked users, signs them out everywhere, and reactivates them", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const staff = await createUser({ roles: ["staff"] });
    const s1 = await signedInSession(staff.id);
    await setUserStatus(makeCtx(), admin, staff.id, "suspended");
    const row = await db.select().from(schema.users).where(eq(schema.users.id, staff.id)).get();
    expect(row?.status).toBe("suspended");
    const session = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, s1.sessionId))
      .get();
    expect(session?.revokedReason).toBe("account_suspended");
    await setUserStatus(makeCtx(), admin, staff.id, "active");
    expect(
      (await db.select().from(schema.users).where(eq(schema.users.id, staff.id)).get())?.status,
    ).toBe("active");
    const actions = (
      await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, staff.id)).all()
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.suspend", "user.reactivate"]));
  });

  it("refuses higher-ranked targets and actors without users.manage", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const owner = await createUser({ roles: ["owner"] });
    expect((await appError(setUserStatus(makeCtx(), admin, owner.id, "suspended"))).code).toBe(
      "forbidden",
    );
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id);
    const member = await createUser({ roles: ["member"] });
    expect((await appError(setUserStatus(makeCtx(), manager, member.id, "suspended"))).code).toBe(
      "forbidden",
    );
    expect((await appError(setUserStatus(makeCtx(), admin, admin.userId, "suspended"))).code).toBe(
      "forbidden",
    );
  });
});
