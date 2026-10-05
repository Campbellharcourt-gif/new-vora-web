import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { writeAudit } from "../observability/audit";
import { notify } from "./notifications";

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

/** The client's own engagement, or 404 (another organisation's id reveals nothing). */
async function ownEngagement(ctx: ServerContext, actor: Actor, engagementId: string) {
  if (!isId(engagementId, "engagement")) throw errors.notFound();
  const row = await ctx.db
    .select({
      id: schema.engagements.id,
      name: schema.engagements.name,
      status: schema.engagements.status,
      summary: schema.engagements.summary,
      startDate: schema.engagements.startDate,
      targetDate: schema.engagements.targetDate,
      updatedAt: schema.engagements.updatedAt,
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
    .where(eq(schema.engagements.id, engagementId))
    .get();
  if (!row) throw errors.notFound();
  return row;
}

/**
 * One project as its client sees it: status, dates, services, milestones, the updates and files
 * shared with them, and who at VORA is working on it. Internal notes and files never appear.
 */
export async function getClientEngagement(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
) {
  const actor = await authorize(ctx, actorInput, "client_portal.access");
  const engagement = await ownEngagement(ctx, actor, engagementId);
  const [services, milestones, updates, files, team] = await Promise.all([
    ctx.db
      .select({ name: schema.services.name })
      .from(schema.engagementServices)
      .innerJoin(schema.services, eq(schema.services.id, schema.engagementServices.serviceId))
      .where(eq(schema.engagementServices.engagementId, engagementId))
      .orderBy(asc(schema.services.name))
      .all(),
    ctx.db
      .select({
        id: schema.milestones.id,
        title: schema.milestones.title,
        description: schema.milestones.description,
        dueDate: schema.milestones.dueDate,
        status: schema.milestones.status,
      })
      .from(schema.milestones)
      .where(eq(schema.milestones.engagementId, engagementId))
      .orderBy(asc(schema.milestones.sortOrder), asc(schema.milestones.createdAt))
      .all(),
    ctx.db
      .select({
        id: schema.engagementMessages.id,
        body: schema.engagementMessages.body,
        createdAt: schema.engagementMessages.createdAt,
        authorName: schema.users.name,
        fromClient: eq(schema.engagementMessages.authorId, actor.userId),
      })
      .from(schema.engagementMessages)
      .leftJoin(schema.users, eq(schema.users.id, schema.engagementMessages.authorId))
      .where(
        and(
          eq(schema.engagementMessages.engagementId, engagementId),
          eq(schema.engagementMessages.visibility, "client"),
          isNull(schema.engagementMessages.deletedAt),
        ),
      )
      .orderBy(desc(schema.engagementMessages.createdAt))
      .limit(100)
      .all(),
    ctx.db
      .select({
        id: schema.engagementFiles.id,
        label: schema.engagementFiles.label,
        createdAt: schema.engagementFiles.createdAt,
        size: schema.mediaAssets.sizeBytes,
        mimeType: schema.mediaAssets.mimeType,
      })
      .from(schema.engagementFiles)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.engagementFiles.mediaId))
      .where(
        and(
          eq(schema.engagementFiles.engagementId, engagementId),
          eq(schema.engagementFiles.visibility, "client"),
          isNull(schema.mediaAssets.deletedAt),
        ),
      )
      .orderBy(desc(schema.engagementFiles.createdAt))
      .all(),
    ctx.db
      .select({ name: schema.users.name })
      .from(schema.engagementStaff)
      .innerJoin(schema.users, eq(schema.users.id, schema.engagementStaff.userId))
      .where(eq(schema.engagementStaff.engagementId, engagementId))
      .orderBy(asc(schema.users.name))
      .all(),
  ]);
  return {
    engagement,
    services: services.map((s) => s.name),
    milestones,
    updates: updates.map((u) => ({ ...u, fromClient: Boolean(u.fromClient) })),
    files,
    team: team.map((t) => t.name),
  };
}

/** A client's message on their own project; the assigned VORA team is notified. */
export async function postClientMessage(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  body: string,
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "client_portal.access");
  const engagement = await ownEngagement(ctx, actor, engagementId);
  const text = body.trim();
  if (text.length < 1 || text.length > 5000) {
    throw errors.validation({ body: "Write a message (up to 5,000 characters)." });
  }
  const now = ctx.clock.now();
  const id = newId("message", now);
  await ctx.db.insert(schema.engagementMessages).values({
    id,
    engagementId,
    authorId: actor.userId,
    body: text,
    visibility: "client",
    createdAt: now,
  });
  await writeAudit(ctx, actor, {
    action: "engagement.client_message",
    targetType: "engagement",
    targetId: engagementId,
    summary: "Client posted a message",
    changes: { messageId: id },
  });
  const staff = await ctx.db
    .select({ id: schema.engagementStaff.userId })
    .from(schema.engagementStaff)
    .where(eq(schema.engagementStaff.engagementId, engagementId))
    .all();
  await notify(
    ctx,
    staff.map((s) => s.id),
    {
      type: "engagement.client_message",
      title: `${actor.name} wrote on ${engagement.name}`,
      link: `/admin/engagements/${engagementId}`,
    },
  );
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
