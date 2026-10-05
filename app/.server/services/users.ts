import { USER_STATUSES } from "@shared/enums";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { activeOwnerExists } from "../auth/bootstrap";
import {
  authorize,
  canGrantRole,
  canManageUser,
  getRolesByKey,
  loadUserAccess,
} from "../auth/rbac";
import { revokeUserSessions } from "../auth/sessions";
import { type Actor, isElevated } from "../auth/types";
import type { ServerContext } from "../context";
import { runBatch, type Statement, schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId } from "../lib/ids";
import { writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";

export interface UserFilter {
  q?: string;
  role?: string;
  status?: string;
}

export async function listUsers(
  ctx: ServerContext,
  actorInput: Actor | null,
  filter: UserFilter = {},
) {
  await authorize(ctx, actorInput, "users.view");
  const conditions = [isNull(schema.users.deletedAt)];
  if (USER_STATUSES.includes(filter.status as never)) {
    conditions.push(eq(schema.users.status, filter.status as never));
  }
  if (filter.role && /^[a-z][a-z_]{0,39}$/.test(filter.role)) {
    conditions.push(
      inArray(
        schema.users.id,
        ctx.db
          .select({ id: schema.userRoles.userId })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
          .where(eq(schema.roles.key, filter.role)),
      ),
    );
  }
  const q = filter.q?.trim().toLowerCase().slice(0, 100);
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const match = or(
      sql`lower(${schema.users.name}) like ${pattern} escape '\\'`,
      sql`${schema.users.email} like ${pattern} escape '\\'`,
    );
    if (match) conditions.push(match);
  }
  const rows = await ctx.db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      status: schema.users.status,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
      roles: sql<string>`coalesce(group_concat(${schema.roles.key}), '')`,
    })
    .from(schema.users)
    .leftJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .leftJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(and(...conditions))
    .groupBy(schema.users.id)
    .orderBy(asc(schema.users.createdAt))
    .all();
  return rows.map((r) => ({ ...r, roles: r.roles ? r.roles.split(",").sort() : [] }));
}

/** Everything the user page shows, filtered by what the viewer may see. */
export async function getUserDetail(ctx: ServerContext, actorInput: Actor | null, userId: string) {
  const actor = await authorize(ctx, actorInput, "users.view");
  const { user, access } = await loadTarget(ctx, userId);
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const [roles, orgs, sessions, logins, activity] = await Promise.all([
    ctx.db
      .select({ key: schema.roles.key, name: schema.roles.name, isSystem: schema.roles.isSystem })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId))
      .orderBy(desc(schema.roles.rank))
      .all(),
    has("clients.view")
      ? ctx.db
          .select({
            id: schema.clientOrgs.id,
            name: schema.clientOrgs.name,
            orgRole: schema.clientOrgMembers.orgRole,
          })
          .from(schema.clientOrgMembers)
          .innerJoin(schema.clientOrgs, eq(schema.clientOrgs.id, schema.clientOrgMembers.orgId))
          .where(eq(schema.clientOrgMembers.userId, userId))
          .all()
      : Promise.resolve([]),
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, userId),
          isNull(schema.sessions.revokedAt),
          sql`${schema.sessions.expiresAt} > ${ctx.clock.now()}`,
        ),
      )
      .get(),
    has("security.view")
      ? ctx.db
          .select({
            id: schema.loginAttempts.id,
            outcome: schema.loginAttempts.outcome,
            country: schema.loginAttempts.country,
            city: schema.loginAttempts.city,
            createdAt: schema.loginAttempts.createdAt,
          })
          .from(schema.loginAttempts)
          .where(eq(schema.loginAttempts.userId, userId))
          .orderBy(desc(schema.loginAttempts.createdAt))
          .limit(10)
          .all()
      : Promise.resolve([]),
    has("audit.view")
      ? ctx.db
          .select({
            id: schema.auditLogs.id,
            summary: schema.auditLogs.summary,
            action: schema.auditLogs.action,
            actorName: schema.users.name,
            createdAt: schema.auditLogs.createdAt,
          })
          .from(schema.auditLogs)
          .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
          .where(
            or(
              and(eq(schema.auditLogs.targetType, "user"), eq(schema.auditLogs.targetId, userId)),
              eq(schema.auditLogs.actorUserId, userId),
            ),
          )
          .orderBy(desc(schema.auditLogs.createdAt))
          .limit(20)
          .all()
      : Promise.resolve([]),
  ]);
  const manageable = canManageUser(actor, { userId, rank: access.rank });
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      twoStep: access.privileged || user.mfaEnforced,
    },
    roles,
    rank: access.rank,
    orgs,
    activeSessions: Number(sessions?.n ?? 0),
    logins,
    activity,
    can: {
      manage: has("users.manage") && manageable,
      assignRoles:
        has("roles.assign") &&
        (manageable || (actor.roles.includes("owner") && actor.userId !== userId)),
    },
  };
}

/** Signs a lower-ranked user out everywhere (e.g. a lost laptop). */
export async function revokeSessionsForUser(
  ctx: ServerContext,
  actorInput: Actor | null,
  userId: string,
): Promise<number> {
  const actor = await authorize(ctx, actorInput, "users.manage");
  const { access } = await loadTarget(ctx, userId);
  if (!canManageUser(actor, { userId, rank: access.rank })) {
    throw errors.forbidden({ reason: "rank" });
  }
  const count = await revokeUserSessions(ctx, userId, "revoked_by_admin");
  await recordSecurityEvent(ctx, {
    type: "auth.sessions.revoked_by_admin",
    severity: "medium",
    userId,
    details: { by: actor.userId, count },
  });
  await writeAudit(ctx, actor, {
    action: "user.sessions.revoke",
    targetType: "user",
    targetId: userId,
    summary: `Signed the user out everywhere (${count} session${count === 1 ? "" : "s"})`,
    changes: { count },
  });
  return count;
}

async function loadTarget(ctx: ServerContext, userId: string) {
  if (!isId(userId, "user")) throw errors.notFound();
  const user = await ctx.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .get();
  if (!user) throw errors.notFound();
  const access = await loadUserAccess(ctx.db, userId);
  return { user, access };
}

async function isLastActiveOwner(ctx: ServerContext, userId: string): Promise<boolean> {
  const row = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(
      and(
        eq(schema.roles.key, "owner"),
        eq(schema.users.status, "active"),
        sql`${schema.users.id} != ${userId}`,
      ),
    )
    .get();
  return Number(row?.n ?? 0) === 0 && (await activeOwnerExists(ctx));
}

/** Suspends or reactivates a lower-ranked user. Suspension signs the user out everywhere. */
export async function setUserStatus(
  ctx: ServerContext,
  actorInput: Actor | null,
  userId: string,
  status: "active" | "suspended",
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "users.manage");
  const { user, access } = await loadTarget(ctx, userId);
  if (!canManageUser(actor, { userId, rank: access.rank }))
    throw errors.forbidden({ reason: "rank" });
  if (
    status === "suspended" &&
    access.roles.includes("owner") &&
    (await isLastActiveOwner(ctx, userId))
  ) {
    throw errors.conflict("The last active Owner cannot be suspended.");
  }
  if (status === "active" && !user.passwordHash)
    throw errors.conflict("This user hasn't set a password yet.");
  const now = ctx.clock.now();
  await ctx.db
    .update(schema.users)
    .set({ status, updatedAt: now })
    .where(eq(schema.users.id, userId));
  if (status === "suspended") await revokeUserSessions(ctx, userId, "account_suspended");
  await writeAudit(ctx, actor, {
    action: status === "suspended" ? "user.suspend" : "user.reactivate",
    targetType: "user",
    targetId: userId,
    summary: `${status === "suspended" ? "Suspended" : "Reactivated"} user`,
    changes: { status: { from: user.status, to: status } },
  });
}

/**
 * Replaces a user's roles. Requires `roles.assign`, a recent step-up, and rank rules: every role
 * added or removed must rank below the actor's (Owners may grant Owner); nobody edits their own
 * roles; the last active Owner keeps the Owner role.
 */
export async function setUserRoles(
  ctx: ServerContext,
  actorInput: Actor | null,
  userId: string,
  roleKeys: string[],
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "roles.assign");
  if (!isElevated(actor, ctx.clock.now())) {
    throw errors.validation({ _form: "Confirm your password to change roles." });
  }
  const { access } = await loadTarget(ctx, userId);
  if (
    !canManageUser(actor, { userId, rank: access.rank }) &&
    !(actor.roles.includes("owner") && actor.userId !== userId)
  ) {
    throw errors.forbidden({ reason: "rank" });
  }
  const wanted = [...new Set(roleKeys)];
  const roles = await getRolesByKey(ctx.db, wanted);
  if (roles.length !== wanted.length) throw errors.validation({ roles: "Unknown role." });

  const current = new Set(access.roles);
  const next = new Set(wanted);
  const changed = [
    ...wanted.filter((k) => !current.has(k)),
    ...access.roles.filter((k) => !next.has(k)),
  ];
  const allRoles = await getRolesByKey(ctx.db, [...new Set([...changed])]);
  for (const role of allRoles) {
    if (!canGrantRole(actor, role.rank, role.key)) {
      await recordSecurityEvent(ctx, {
        type: "authz.denied",
        severity: "medium",
        userId: actor.userId,
        details: { attempted: "set_roles", role: role.key, target: userId },
      });
      throw errors.forbidden({ role: role.key });
    }
  }
  if (current.has("owner") && !next.has("owner") && (await isLastActiveOwner(ctx, userId))) {
    throw errors.conflict("The last active Owner must keep the Owner role.");
  }

  const now = ctx.clock.now();
  const statements: Statement[] = [
    ctx.db.delete(schema.userRoles).where(
      and(
        eq(schema.userRoles.userId, userId),
        sql`${schema.userRoles.roleId} not in (${sql.join(
          roles.map((r) => sql`${r.id}`),
          sql`, `,
        )})`,
      ),
    ),
    ...roles.map((role) =>
      ctx.db
        .insert(schema.userRoles)
        .values({ userId, roleId: role.id, grantedBy: actor.userId, grantedAt: now })
        .onConflictDoNothing(),
    ),
  ];
  await runBatch(ctx.db, statements);
  // Privilege change → the user signs in again (fresh session token, 2FA where now required).
  const revoked = await revokeUserSessions(ctx, userId, "roles_changed");
  await recordSecurityEvent(ctx, {
    type: "roles.changed",
    severity: "medium",
    userId,
    details: { by: actor.userId, from: access.roles, to: wanted, sessionCount: revoked },
  });
  await writeAudit(ctx, actor, {
    action: "user.roles.set",
    targetType: "user",
    targetId: userId,
    summary: `Changed roles to ${wanted.join(", ") || "none"}`,
    changes: { roles: { from: access.roles, to: wanted } },
  });
}

export async function usersWithPermission(ctx: ServerContext, roleKeys: string[]) {
  if (roleKeys.length === 0) return [];
  return ctx.db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(and(inArray(schema.roles.key, roleKeys), eq(schema.users.status, "active")))
    .all();
}
