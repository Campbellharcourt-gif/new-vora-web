import { and, asc, eq, inArray } from "drizzle-orm";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId } from "../lib/ids";

/**
 * Client-portal read model. Clients see only engagements of organisations they belong to; the
 * query is scoped by membership in SQL (not filtered afterwards), and internal files/messages are
 * excluded at this layer for every client-facing read.
 */
export async function listClientEngagements(ctx: ServerContext, actorInput: Actor | null) {
  const actor = await authorize(ctx, actorInput, "client_portal.access");
  return ctx.db
    .select({
      id: schema.engagements.id,
      name: schema.engagements.name,
      status: schema.engagements.status,
      orgName: schema.clientOrgs.name,
    })
    .from(schema.engagements)
    .innerJoin(schema.clientOrgs, eq(schema.clientOrgs.id, schema.engagements.orgId))
    .innerJoin(
      schema.clientOrgMembers,
      and(
        eq(schema.clientOrgMembers.orgId, schema.engagements.orgId),
        eq(schema.clientOrgMembers.userId, actor.userId),
      ),
    )
    .orderBy(asc(schema.engagements.createdAt))
    .all();
}

/** Policy: can this actor view this engagement? (staff: engagements.view + assignment unless manager+) */
export async function canViewEngagement(
  ctx: ServerContext,
  actor: Actor,
  engagementId: string,
): Promise<boolean> {
  if (!isId(engagementId, "engagement")) return false;
  if (actor.permissions.has("engagements.view")) {
    if (actor.rank >= 60) return true; // Manager and above see all engagements.
    const assigned = await ctx.db
      .select({ id: schema.engagementStaff.engagementId })
      .from(schema.engagementStaff)
      .where(
        and(
          eq(schema.engagementStaff.engagementId, engagementId),
          eq(schema.engagementStaff.userId, actor.userId),
        ),
      )
      .get();
    return Boolean(assigned);
  }
  if (actor.permissions.has("client_portal.access")) {
    const member = await ctx.db
      .select({ id: schema.engagements.id })
      .from(schema.engagements)
      .innerJoin(
        schema.clientOrgMembers,
        eq(schema.clientOrgMembers.orgId, schema.engagements.orgId),
      )
      .where(
        and(
          eq(schema.engagements.id, engagementId),
          eq(schema.clientOrgMembers.userId, actor.userId),
        ),
      )
      .get();
    return Boolean(member);
  }
  return false;
}

/** Files visible to the actor for an engagement. Clients never receive `internal` files. */
export async function listEngagementFiles(ctx: ServerContext, actor: Actor, engagementId: string) {
  if (!(await canViewEngagement(ctx, actor, engagementId))) throw errors.notFound();
  const staff = actor.permissions.has("engagements.view");
  const visibility: ("client" | "internal")[] = staff ? ["client", "internal"] : ["client"];
  return ctx.db
    .select({
      id: schema.engagementFiles.id,
      label: schema.engagementFiles.label,
      visibility: schema.engagementFiles.visibility,
      createdAt: schema.engagementFiles.createdAt,
    })
    .from(schema.engagementFiles)
    .where(
      and(
        eq(schema.engagementFiles.engagementId, engagementId),
        inArray(schema.engagementFiles.visibility, visibility),
      ),
    )
    .orderBy(asc(schema.engagementFiles.createdAt))
    .all();
}
