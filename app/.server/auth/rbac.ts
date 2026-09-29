import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  isPermission,
  PERMISSIONS,
  type Permission,
  permissionCategory,
  RBAC_VERSION,
} from "@shared/permissions";
import { eq, inArray, sql } from "drizzle-orm";
import type { ServerContext } from "../context";
import type { Database } from "../db/client";
import { runBatch, type Statement, schema } from "../db/client";
import { AppError, errors } from "../lib/errors";
import { newId } from "../lib/ids";
import { recordSecurityEvent } from "../observability/security-events";
import type { Actor } from "./types";

export interface UserAccess {
  roles: string[];
  rank: number;
  privileged: boolean;
  permissions: Set<Permission>;
}

/** Resolves a user's roles and effective permissions from the database (source of truth). */
export async function loadUserAccess(db: Database, userId: string): Promise<UserAccess> {
  const rows = await db
    .select({
      key: schema.roles.key,
      rank: schema.roles.rank,
      privileged: schema.roles.isPrivileged,
      permission: schema.rolePermissions.permissionKey,
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, userId));

  const roles = new Set<string>();
  const permissions = new Set<Permission>();
  let rank = 0;
  let privileged = false;
  for (const row of rows) {
    roles.add(row.key);
    rank = Math.max(rank, row.rank);
    privileged ||= row.privileged;
    if (row.permission && isPermission(row.permission)) permissions.add(row.permission);
  }
  return { roles: [...roles].sort(), rank, privileged, permissions };
}

/** Throws 403 (and records the denial) unless the actor holds the permission. */
export async function authorize(
  ctx: ServerContext,
  actor: Actor | null,
  permission: Permission,
): Promise<Actor> {
  if (!actor) throw errors.unauthenticated();
  if (!actor.permissions.has(permission)) {
    await recordSecurityEvent(ctx, {
      type: "authz.denied",
      severity: "low",
      userId: actor.userId,
      details: { permission },
    });
    throw errors.forbidden({ permission });
  }
  return actor;
}

export function can(actor: Actor | null, permission: Permission): boolean {
  return Boolean(actor?.permissions.has(permission));
}

/**
 * Role-grant rule: an actor may grant or revoke a role only if it ranks strictly below their own
 * highest role. Owners may also grant Owner. Nobody may change their own roles.
 */
export function canGrantRole(
  actor: Pick<Actor, "rank" | "roles" | "permissions">,
  roleRank: number,
  roleKey: string,
): boolean {
  if (!actor.permissions.has("roles.assign") && !actor.permissions.has("users.invite"))
    return false;
  if (roleKey === "owner") return actor.roles.includes("owner");
  return roleRank < actor.rank;
}

/** An actor may manage a user only if the target's highest role ranks below the actor's. */
export function canManageUser(
  actor: Pick<Actor, "rank" | "userId">,
  target: { userId: string; rank: number },
): boolean {
  if (actor.userId === target.userId) return false;
  return target.rank < actor.rank;
}

export async function getRolesByKey(db: Database, keys: readonly string[]) {
  if (keys.length === 0) return [];
  return db
    .select()
    .from(schema.roles)
    .where(inArray(schema.roles.key, [...keys]));
}

/**
 * Synchronises permissions and system roles from code into the database. System-role
 * composition is code-defined (reviewed in version control); custom roles are left untouched.
 * Idempotent; guarded by RBAC_VERSION so it runs once per change.
 */
export async function syncRbac(db: Database, now: number, force = false): Promise<boolean> {
  if (!force) {
    const current = await db
      .select({ value: schema.siteSettings.value })
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.key, "system.rbac_version"))
      .get();
    if (current && Number(current.value) >= RBAC_VERSION) return false;
  }

  const statements: Statement[] = [];
  for (const key of ALL_PERMISSIONS) {
    statements.push(
      db
        .insert(schema.permissions)
        .values({ key, category: permissionCategory(key), description: PERMISSIONS[key] })
        .onConflictDoUpdate({
          target: schema.permissions.key,
          set: { category: permissionCategory(key), description: PERMISSIONS[key] },
        }),
    );
  }
  for (const role of DEFAULT_ROLES) {
    statements.push(
      db
        .insert(schema.roles)
        .values({
          id: newId("role", now),
          key: role.key,
          name: role.name,
          description: role.description,
          rank: role.rank,
          isSystem: true,
          isPrivileged: role.privileged,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.roles.key,
          set: {
            name: role.name,
            description: role.description,
            rank: role.rank,
            isSystem: true,
            isPrivileged: role.privileged,
            updatedAt: now,
          },
        }),
    );
  }
  // Remove permissions that no longer exist in code (cascades to role_permissions). Keys are
  // code constants validated against a strict pattern, so they are inlined rather than bound
  // (D1 caps bound parameters per statement).
  for (const key of ALL_PERMISSIONS) {
    if (!/^[a-z_]+(\.[a-z_]+)+$/.test(key)) throw new Error(`Unsafe permission key: ${key}`);
  }
  statements.push(
    db
      .delete(schema.permissions)
      .where(
        sql`${schema.permissions.key} not in (${sql.raw(ALL_PERMISSIONS.map((p) => `'${p}'`).join(", "))})`,
      ),
  );
  await runBatch(db, statements);

  const roleRows = await db
    .select({ id: schema.roles.id, key: schema.roles.key })
    .from(schema.roles);
  const byKey = new Map(roleRows.map((r) => [r.key, r.id]));
  const rpStatements: Statement[] = [];
  for (const role of DEFAULT_ROLES) {
    const roleId = byKey.get(role.key);
    if (!roleId) throw new AppError("internal_error", { internal: { missingRole: role.key } });
    rpStatements.push(
      db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId)),
    );
    for (const permission of role.permissions) {
      rpStatements.push(
        db.insert(schema.rolePermissions).values({ roleId, permissionKey: permission }),
      );
    }
  }
  rpStatements.push(
    db
      .insert(schema.siteSettings)
      .values({ key: "system.rbac_version", value: RBAC_VERSION, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.siteSettings.key,
        set: { value: RBAC_VERSION, updatedAt: now },
      }),
  );
  await runBatch(db, rpStatements);
  return true;
}
