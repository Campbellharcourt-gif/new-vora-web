import { and, desc, eq, like, lt, type SQL } from "drizzle-orm";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";

/**
 * Read side of the append-only audit log. `listAudit` is the admin audit view (`audit.view`);
 * `activityFor` serves "activity" panels on records whose own access check the caller has already
 * made (an engagement, a user) — it never decides access itself.
 */

export interface AuditFilter {
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  /** Action prefix, e.g. "user." or "content.publish". */
  action?: string;
  before?: number;
  limit?: number;
}

const ACTION_PATTERN = /^[a-z_.]{1,60}$/;
const TARGET_TYPE_PATTERN = /^[a-z_]{1,40}$/;

function conditions(filter: AuditFilter): SQL[] {
  const out: SQL[] = [];
  if (filter.actorUserId) out.push(eq(schema.auditLogs.actorUserId, filter.actorUserId));
  if (filter.targetType && TARGET_TYPE_PATTERN.test(filter.targetType))
    out.push(eq(schema.auditLogs.targetType, filter.targetType));
  if (filter.targetId) out.push(eq(schema.auditLogs.targetId, filter.targetId));
  if (filter.action && ACTION_PATTERN.test(filter.action))
    out.push(like(schema.auditLogs.action, `${filter.action}%`));
  if (filter.before) out.push(lt(schema.auditLogs.createdAt, filter.before));
  return out;
}

async function query(ctx: ServerContext, filter: AuditFilter) {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const where = conditions(filter);
  const rows = await ctx.db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      summary: schema.auditLogs.summary,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      actorUserId: schema.auditLogs.actorUserId,
      actorName: schema.users.name,
      changes: schema.auditLogs.changes,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorUserId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextBefore: hasMore ? (items.at(-1)?.createdAt ?? null) : null };
}

export async function listAudit(ctx: ServerContext, actorInput: Actor | null, filter: AuditFilter) {
  await authorize(ctx, actorInput, "audit.view");
  return query(ctx, filter);
}

/** Activity on one record. The caller must already have checked the actor may view it. */
export async function activityFor(
  ctx: ServerContext,
  targetType: string,
  targetId: string,
  limit = 30,
) {
  return (await query(ctx, { targetType, targetId, limit })).items;
}
