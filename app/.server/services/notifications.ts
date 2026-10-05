import type { Permission } from "@shared/permissions";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId, newId } from "../lib/ids";

/**
 * In-app notifications (governance schema `notifications`). Deliberately few: a client hears about
 * updates and files shared on their own projects, staff hear about work assigned to them, and
 * people with the relevant permission hear about events that need action (a new client account to
 * link, a privacy request). Every read is scoped to the signed-in user in SQL.
 */

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  /** A site path ("/client/projects/…"). Anything else is dropped. */
  link?: string | null;
}

const safeLink = (link: string | null | undefined) =>
  link?.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\") && !/[\r\n]/.test(link)
    ? link
    : null;

/** Creates one notification per recipient (duplicates in the list are ignored). */
export async function notify(
  ctx: ServerContext,
  userIds: string | readonly string[],
  input: NotificationInput,
): Promise<number> {
  const ids = [...new Set(typeof userIds === "string" ? [userIds] : userIds)].filter((id) =>
    isId(id, "user"),
  );
  if (ids.length === 0) return 0;
  const now = ctx.clock.now();
  await ctx.db.insert(schema.notifications).values(
    ids.map((userId) => ({
      id: newId("notification", now),
      userId,
      type: input.type.slice(0, 60),
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 1000) ?? null,
      link: safeLink(input.link),
      createdAt: now,
    })),
  );
  return ids.length;
}

/** Active users holding a permission through any of their roles. */
export async function activeUsersWithPermission(
  ctx: ServerContext,
  permission: Permission,
): Promise<string[]> {
  const rows = await ctx.db
    .selectDistinct({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
    .where(
      and(
        eq(schema.rolePermissions.permissionKey, permission),
        eq(schema.users.status, "active"),
        isNull(schema.users.deletedAt),
      ),
    )
    .all();
  return rows.map((r) => r.id);
}

/** Notifies everyone who holds a permission (optionally excluding the person who acted). */
export async function notifyPermissionHolders(
  ctx: ServerContext,
  permission: Permission,
  input: NotificationInput,
  exceptUserId?: string | null,
): Promise<number> {
  const ids = (await activeUsersWithPermission(ctx, permission)).filter(
    (id) => id !== exceptUserId,
  );
  return notify(ctx, ids, input);
}

export async function listNotifications(
  ctx: ServerContext,
  actor: Actor,
  options: { limit?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  return ctx.db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      title: schema.notifications.title,
      body: schema.notifications.body,
      link: schema.notifications.link,
      readAt: schema.notifications.readAt,
      createdAt: schema.notifications.createdAt,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, actor.userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)
    .all();
}

export async function unreadNotificationCount(ctx: ServerContext, actor: Actor): Promise<number> {
  const row = await ctx.db
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, actor.userId), isNull(schema.notifications.readAt)))
    .get();
  return row?.n ?? 0;
}

/** Marks one of the actor's notifications (or all of them) as read. */
export async function markNotificationsRead(
  ctx: ServerContext,
  actor: Actor,
  which: "all" | string[],
): Promise<void> {
  const now = ctx.clock.now();
  const own = and(
    eq(schema.notifications.userId, actor.userId),
    isNull(schema.notifications.readAt),
  );
  if (which === "all") {
    await ctx.db.update(schema.notifications).set({ readAt: now }).where(own);
    return;
  }
  const ids = which.filter((id) => isId(id, "notification"));
  if (ids.length === 0) throw errors.validation({ _form: "Nothing to mark as read." });
  await ctx.db
    .update(schema.notifications)
    .set({ readAt: now })
    .where(and(own, inArray(schema.notifications.id, ids)));
}

/** Retention: read notifications older than 180 days are removed by the daily job. */
export async function pruneNotifications(ctx: ServerContext): Promise<number> {
  const cutoff = ctx.clock.now() - 180 * 24 * 60 * 60 * 1000;
  const result = await ctx.db
    .delete(schema.notifications)
    .where(
      and(
        sql`${schema.notifications.readAt} is not null`,
        sql`${schema.notifications.createdAt} < ${cutoff}`,
      ),
    )
    .returning({ id: schema.notifications.id });
  return result.length;
}
