import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { elevate } from "~/.server/auth/account";
import { loadUserAccess } from "~/.server/auth/rbac";
import { AppError } from "~/.server/lib/errors";
import { listAudit } from "~/.server/services/activity";
import { listSecurityEvents } from "~/.server/services/admin-workspace";
import { listContent, publishContent } from "~/.server/services/content-admin";
import { listClients, listEngagements } from "~/.server/services/engagements";
import { listEnquiries } from "~/.server/services/enquiries";
import { deleteCustomRole, saveCustomRole } from "~/.server/services/roles";
import { setSetting } from "~/.server/services/settings";
import {
  getUserDetail,
  listUsers,
  revokeSessionsForUser,
  setUserRoles,
} from "~/.server/services/users";
import {
  actorFor,
  call,
  createUser,
  db,
  makeCtx,
  PASSWORD,
  schema,
  signedInSession,
} from "../support/helpers";

async function denied(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!error) return "allowed";
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

type Actor = Awaited<ReturnType<typeof actorFor>>;
const ROLES = ["owner", "admin", "staff", "client", "member"] as const;
const actors = {} as Record<(typeof ROLES)[number], Actor>;

beforeAll(async () => {
  for (const role of ROLES) actors[role] = await actorFor((await createUser({ roles: [role] })).id);
});

describe("RBAC — the five account types, enforced in services and over HTTP", () => {
  const OPERATIONS = {
    "list users": (a: Actor) => listUsers(makeCtx(), a),
    "list enquiries": (a: Actor) => listEnquiries(makeCtx(), a),
    "list clients": (a: Actor) => listClients(makeCtx(), a),
    "list client projects": (a: Actor) => listEngagements(makeCtx(), a),
    "list case studies": (a: Actor) => listContent(makeCtx(), a, "project"),
    "read the audit log": (a: Actor) => listAudit(makeCtx(), a, {}),
    "read security events": (a: Actor) => listSecurityEvents(makeCtx(), a),
    "change site settings": (a: Actor) =>
      setSetting(makeCtx(), a, "site.identity", {
        name: "VORA",
        tagline: null,
        partnerLine: "Creative by Solara. Digital by VORA.",
      }),
  } as const;

  const EXPECTED: Record<keyof typeof OPERATIONS, Record<(typeof ROLES)[number], string>> = {
    "list users": {
      owner: "allowed",
      admin: "allowed",
      staff: "forbidden",
      client: "forbidden",
      member: "forbidden",
    },
    "list enquiries": {
      owner: "allowed",
      admin: "allowed",
      staff: "allowed",
      client: "forbidden",
      member: "forbidden",
    },
    "list clients": {
      owner: "allowed",
      admin: "allowed",
      staff: "allowed",
      client: "forbidden",
      member: "forbidden",
    },
    "list client projects": {
      owner: "allowed",
      admin: "allowed",
      staff: "allowed",
      client: "forbidden",
      member: "forbidden",
    },
    "list case studies": {
      owner: "allowed",
      admin: "allowed",
      staff: "allowed",
      client: "forbidden",
      member: "forbidden",
    },
    "read the audit log": {
      owner: "allowed",
      admin: "allowed",
      staff: "forbidden",
      client: "forbidden",
      member: "forbidden",
    },
    "read security events": {
      owner: "allowed",
      admin: "allowed",
      staff: "forbidden",
      client: "forbidden",
      member: "forbidden",
    },
    "change site settings": {
      owner: "allowed",
      admin: "allowed",
      staff: "forbidden",
      client: "forbidden",
      member: "forbidden",
    },
  };

  for (const [name, run] of Object.entries(OPERATIONS)) {
    it(`${name}`, async () => {
      for (const role of ROLES) {
        const expected = EXPECTED[name as keyof typeof OPERATIONS][role];
        expect(await denied(run(actors[role])), `${role}: ${name}`).toBe(expected);
      }
      expect(await denied(run(null as unknown as Actor))).toBe("unauthenticated");
    });
  }

  it("staff can draft but never publish", async () => {
    const id = (await listContent(makeCtx(), actors.owner, "project"))[0]?.id ?? "";
    expect(await denied(publishContent(makeCtx(), actors.staff, "project", id))).toBe("forbidden");
  });

  it("the permissioned API answers 403 to clients and members and 401 to anonymous callers", async () => {
    // (Page routes are covered by the browser suite: the integration harness renders a stub page.)
    for (const role of ["client", "member", "staff"] as const) {
      const res = await call("/api/v1/system/status", { token: actors[role].token });
      expect(res.status, role).toBe(403);
    }
    expect((await call("/api/v1/system/status", { token: actors.admin.token })).status).toBe(200);
    expect((await call("/api/v1/system/status")).status).toBe(401);
  });
});

describe("user management", () => {
  it("only higher-ranked people can sign someone out or see manage controls", async () => {
    const staff = await createUser({ roles: ["staff"] });
    await signedInSession(staff.id);
    expect(await revokeSessionsForUser(makeCtx(), actors.admin, staff.id)).toBe(1);
    expect(await denied(revokeSessionsForUser(makeCtx(), actors.admin, actors.owner.userId))).toBe(
      "forbidden",
    );
    expect(await denied(revokeSessionsForUser(makeCtx(), actors.staff, actors.admin.userId))).toBe(
      "forbidden",
    );
    const detail = await getUserDetail(makeCtx(), actors.admin, actors.owner.userId);
    expect(detail.can.manage).toBe(false);
    const self = await getUserDetail(makeCtx(), actors.admin, actors.admin.userId);
    expect(self.can.manage).toBe(false);
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "user.sessions.revoke"))
      .all();
    expect(audit.some((a) => a.targetId === staff.id)).toBe(true);
  });

  it("filters people by role, status and search", async () => {
    await createUser({ roles: ["member"], name: "Morgan Findable" });
    const members = await listUsers(makeCtx(), actors.admin, { role: "member" });
    expect(members.every((u) => u.roles.includes("member"))).toBe(true);
    const found = await listUsers(makeCtx(), actors.admin, { q: "findable" });
    expect(found.map((u) => u.name)).toEqual(["Morgan Findable"]);
  });
});

describe("custom roles (Owner only)", () => {
  it("need the Owner, a password confirmation, and stay below Admin", async () => {
    const input = {
      name: "Content editor",
      rank: 30,
      permissions: ["admin.access", "pages.view", "pages.edit"],
    };
    expect(await denied(saveCustomRole(makeCtx(), actors.admin, null, input))).toBe("forbidden");
    expect(await denied(saveCustomRole(makeCtx(), actors.owner, null, input))).toBe(
      "validation_failed",
    );
    await elevate(makeCtx(), actors.owner, PASSWORD);
    const owner = await actorFor(actors.owner.userId, { elevated: true });
    expect(await denied(saveCustomRole(makeCtx(), owner, null, { ...input, rank: 95 }))).toBe(
      "validation_failed",
    );
    expect(
      await denied(
        saveCustomRole(makeCtx(), owner, null, { ...input, permissions: ["roles.manage"] }),
      ),
    ).toBe("validation_failed");

    const roleId = await saveCustomRole(makeCtx(), owner, null, input);
    const role = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).get();
    expect(role).toMatchObject({ isSystem: false, isPrivileged: true, rank: 30 });

    // Assign it; the holder gets exactly those permissions.
    const editor = await createUser({ roles: [] });
    await setUserRoles(makeCtx(), owner, editor.id, [role?.key ?? ""]);
    const access = await loadUserAccess(db, editor.id);
    expect([...access.permissions].sort()).toEqual(["admin.access", "pages.edit", "pages.view"]);
    expect(access.privileged).toBe(true);

    // Changing the role signs holders out; deleting is blocked while anyone holds it.
    const session = await signedInSession(editor.id);
    await saveCustomRole(makeCtx(), owner, roleId, {
      ...input,
      permissions: ["admin.access", "pages.view"],
    });
    const row = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.sessionId))
      .get();
    expect(row?.revokedAt).not.toBeNull();
    expect([...(await loadUserAccess(db, editor.id)).permissions].sort()).toEqual([
      "admin.access",
      "pages.view",
    ]);
    expect(await denied(deleteCustomRole(makeCtx(), owner, roleId))).toBe("conflict");
    await setUserRoles(makeCtx(), owner, editor.id, []);
    await deleteCustomRole(makeCtx(), owner, roleId);
  });

  it("system roles can't be edited or deleted", async () => {
    await elevate(makeCtx(), actors.owner, PASSWORD);
    const owner = await actorFor(actors.owner.userId, { elevated: true });
    const admin = await db.select().from(schema.roles).where(eq(schema.roles.key, "admin")).get();
    expect(
      await denied(
        saveCustomRole(makeCtx(), owner, admin?.id ?? "", {
          name: "Admin",
          rank: 80,
          permissions: [],
        }),
      ),
    ).toBe("conflict");
    expect(await denied(deleteCustomRole(makeCtx(), owner, admin?.id ?? ""))).toBe("conflict");
  });
});
