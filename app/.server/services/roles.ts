import {
  ALL_PERMISSIONS,
  isPermission,
  PERMISSIONS,
  type Permission,
  permissionCategory,
  SYSTEM_ROLE_KEYS,
} from "@shared/permissions";
import { fieldErrors } from "@shared/validation/common";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../auth/rbac";
import { revokeUserSessions } from "../auth/sessions";
import { type Actor, isElevated } from "../auth/types";
import type { ServerContext } from "../context";
import { runBatch, type Statement, schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";

/**
 * Roles. The six system roles are defined in code (shared/permissions.ts) and re-synced on
 * deploy; Owners may add custom roles with their own permission sets. Rules for custom roles:
 * - only Owners (roles.manage), after confirming their password;
 * - rank 1–90, so a custom role never equals or outranks Admin or Owner;
 * - never `roles.manage`, and never a permission the Owner role doesn't have;
 * - any role that opens the admin workspace requires two-step verification at sign-in;
 * - changing a role signs everyone who holds it out, so new permissions apply at once.
 */

const MAX_CUSTOM_RANK = 90;
const FORBIDDEN_IN_CUSTOM: Permission[] = ["roles.manage"];

export async function listRoles(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "users.view");
  const rows = await ctx.db
    .select({
      id: schema.roles.id,
      key: schema.roles.key,
      name: schema.roles.name,
      description: schema.roles.description,
      rank: schema.roles.rank,
      isSystem: schema.roles.isSystem,
      isPrivileged: schema.roles.isPrivileged,
      holders: sql<number>`(select count(*) from ${schema.userRoles} where ${schema.userRoles.roleId} = ${schema.roles.id})`,
    })
    .from(schema.roles)
    .orderBy(desc(schema.roles.rank), asc(schema.roles.name))
    .all();
  const perms = await ctx.db
    .select({ roleId: schema.rolePermissions.roleId, key: schema.rolePermissions.permissionKey })
    .from(schema.rolePermissions)
    .all();
  return rows.map((r) => ({
    ...r,
    holders: Number(r.holders),
    permissions: perms
      .filter((p) => p.roleId === r.id)
      .map((p) => p.key)
      .filter(isPermission)
      .sort(),
  }));
}

/** The permission catalogue, grouped for the role editor. */
export function permissionCatalogue() {
  const groups = new Map<string, { key: Permission; description: string }[]>();
  for (const key of ALL_PERMISSIONS) {
    if (FORBIDDEN_IN_CUSTOM.includes(key)) continue;
    const category = permissionCategory(key);
    const list = groups.get(category) ?? [];
    list.push({ key, description: PERMISSIONS[key] });
    groups.set(category, list);
  }
  return [...groups.entries()].map(([category, permissions]) => ({ category, permissions }));
}

const roleInput = z.object({
  name: z.string().trim().min(2, "Give the role a name.").max(60),
  description: z.string().trim().max(200).optional().default(""),
  rank: z.coerce
    .number()
    .int("Use a whole number.")
    .min(1, "Rank must be at least 1.")
    .max(MAX_CUSTOM_RANK, `Custom roles rank at most ${MAX_CUSTOM_RANK}, below Admin.`),
  permissions: z.array(z.string()).max(ALL_PERMISSIONS.length),
});

function roleKeyFrom(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return base.length >= 2 ? base : "custom";
}

async function requireOwnerStepUp(ctx: ServerContext, actorInput: Actor | null) {
  const actor = await authorize(ctx, actorInput, "roles.manage");
  if (!isElevated(actor, ctx.clock.now())) {
    throw errors.validation({ _form: "Confirm your password to change roles." });
  }
  return actor;
}

function cleanPermissions(input: string[]): Permission[] {
  const wanted = [...new Set(input)];
  const unknown = wanted.filter((p) => !isPermission(p));
  if (unknown.length > 0) throw errors.validation({ permissions: "Unknown permission." });
  const forbidden = wanted.filter((p) => FORBIDDEN_IN_CUSTOM.includes(p as Permission));
  if (forbidden.length > 0) {
    throw errors.validation({ permissions: "Only the Owner role can manage roles." });
  }
  return wanted as Permission[];
}

export async function saveCustomRole(
  ctx: ServerContext,
  actorInput: Actor | null,
  roleId: string | null,
  input: { name: string; description?: string; rank: unknown; permissions: string[] },
): Promise<string> {
  const actor = await requireOwnerStepUp(ctx, actorInput);
  const parsed = roleInput.safeParse(input);
  if (!parsed.success) {
    throw errors.validation(fieldErrors(parsed.error), "Please check the role.");
  }
  const v = parsed.data;
  const permissions = cleanPermissions(v.permissions);
  const privileged = permissions.includes("admin.access");
  const now = ctx.clock.now();

  if (!roleId) {
    let key = roleKeyFrom(v.name);
    if ((SYSTEM_ROLE_KEYS as readonly string[]).includes(key)) key = `${key}_custom`;
    const taken = await ctx.db
      .select({ key: schema.roles.key })
      .from(schema.roles)
      .where(
        sql`${schema.roles.key} = ${key} or ${schema.roles.key} like ${`${key}\\_%`} escape '\\'`,
      )
      .all();
    if (taken.length > 0) key = `${key}_${taken.length + 1}`.slice(0, 40);
    const id = newId("role", now);
    const statements: Statement[] = [
      ctx.db.insert(schema.roles).values({
        id,
        key,
        name: v.name,
        description: v.description,
        rank: v.rank,
        isSystem: false,
        isPrivileged: privileged,
        createdAt: now,
        updatedAt: now,
      }),
      ...permissions.map((permissionKey) =>
        ctx.db.insert(schema.rolePermissions).values({ roleId: id, permissionKey }),
      ),
    ];
    await runBatch(ctx.db, statements);
    await writeAudit(ctx, actor, {
      action: "role.create",
      targetType: "role",
      targetId: id,
      summary: `Created role ${v.name}`,
      changes: { key, rank: v.rank, permissions },
    });
    await recordSecurityEvent(ctx, {
      type: "roles.definition.changed",
      severity: "medium",
      userId: actor.userId,
      details: { role: key, change: "created" },
    });
    return id;
  }

  if (!isId(roleId, "role")) throw errors.notFound();
  const role = await ctx.db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).get();
  if (!role) throw errors.notFound();
  if (role.isSystem) {
    throw errors.conflict("System roles are defined by VORA and can't be edited here.");
  }
  const before = (
    await ctx.db
      .select({ key: schema.rolePermissions.permissionKey })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId))
      .all()
  ).map((p) => p.key);
  await runBatch(ctx.db, [
    ctx.db
      .update(schema.roles)
      .set({
        name: v.name,
        description: v.description,
        rank: v.rank,
        isPrivileged: privileged,
        updatedAt: now,
      })
      .where(eq(schema.roles.id, roleId)),
    ctx.db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId)),
    ...permissions.map((permissionKey) =>
      ctx.db.insert(schema.rolePermissions).values({ roleId, permissionKey }),
    ),
  ]);
  // Everyone holding the role signs in again, so the new permissions (and 2FA) apply at once.
  const holders = await ctx.db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.roleId, roleId))
    .all();
  for (const h of holders) await revokeUserSessions(ctx, h.userId, "role_definition_changed");
  await writeAudit(ctx, actor, {
    action: "role.update",
    targetType: "role",
    targetId: roleId,
    summary: `Updated role ${v.name}`,
    changes: {
      rank: { from: role.rank, to: v.rank },
      added: permissions.filter((p) => !before.includes(p)),
      removed: before.filter((p) => !permissions.includes(p as Permission)),
    },
  });
  await recordSecurityEvent(ctx, {
    type: "roles.definition.changed",
    severity: "medium",
    userId: actor.userId,
    details: { role: role.key, change: "updated", holders: holders.length },
  });
  return roleId;
}

export async function deleteCustomRole(
  ctx: ServerContext,
  actorInput: Actor | null,
  roleId: string,
): Promise<void> {
  const actor = await requireOwnerStepUp(ctx, actorInput);
  if (!isId(roleId, "role")) throw errors.notFound();
  const role = await ctx.db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).get();
  if (!role) throw errors.notFound();
  if (role.isSystem) throw errors.conflict("System roles can't be deleted.");
  const holders = await ctx.db
    .select({ n: count() })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.roleId, roleId))
    .get();
  if (Number(holders?.n ?? 0) > 0) {
    throw errors.conflict("Remove this role from everyone who has it before deleting it.");
  }
  await ctx.db.delete(schema.roles).where(eq(schema.roles.id, roleId));
  await writeAudit(ctx, actor, {
    action: "role.delete",
    targetType: "role",
    targetId: roleId,
    summary: `Deleted role ${role.name}`,
  });
  await recordSecurityEvent(ctx, {
    type: "roles.definition.changed",
    severity: "medium",
    userId: actor.userId,
    details: { role: role.key, change: "deleted" },
  });
}

/** Role options a given actor may grant (system and custom), for the user page. */
export async function grantableRoles(ctx: ServerContext, actor: Actor) {
  const rows = await ctx.db
    .select({ key: schema.roles.key, name: schema.roles.name, rank: schema.roles.rank })
    .from(schema.roles)
    .orderBy(desc(schema.roles.rank))
    .all();
  return rows.filter((r) =>
    r.key === "owner" ? actor.roles.includes("owner") : r.rank < actor.rank,
  );
}
