import { slugify } from "@shared/content/kinds";
import { ENGAGEMENT_STATUSES, MILESTONE_STATUSES } from "@shared/enums";
import {
  emailAddress,
  fieldErrors,
  normaliseUrlInput,
  optionalText,
  text,
} from "@shared/validation/common";
import { and, asc, count, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { diff, writeAudit } from "../observability/audit";
import { activityFor } from "./activity";
import { isUniqueViolation } from "./content-admin";
import { validateUpload } from "./files";
import { activeUsersWithPermission, notify } from "./notifications";

/**
 * Clients (organisations) and their projects ("engagements" in the schema) — the admin side.
 *
 * Access model, enforced here for every call:
 * - clients.view / clients.manage: the organisation records and who belongs to them.
 * - engagements.view / engagements.manage: project work. Managers and above see every project;
 *   Staff see and work on only the projects they are assigned to.
 * - Creating projects and assigning staff needs clients.manage (Manager and above).
 * The client-facing reads live in client-portal.ts and are scoped by organisation membership.
 */

const MANAGER_RANK = 60;

// --- Access helpers ------------------------------------------------------------------------------

async function isAssigned(ctx: ServerContext, engagementId: string, userId: string) {
  const row = await ctx.db
    .select({ id: schema.engagementStaff.engagementId })
    .from(schema.engagementStaff)
    .where(
      and(
        eq(schema.engagementStaff.engagementId, engagementId),
        eq(schema.engagementStaff.userId, userId),
      ),
    )
    .get();
  return Boolean(row);
}

/** Loads an engagement the actor may work on (404 when it doesn't exist or isn't theirs). */
async function engagementFor(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  mode: "view" | "manage",
) {
  const actor = await authorize(
    ctx,
    actorInput,
    mode === "view" ? "engagements.view" : "engagements.manage",
  );
  if (!isId(engagementId, "engagement")) throw errors.notFound();
  const engagement = await ctx.db
    .select()
    .from(schema.engagements)
    .where(eq(schema.engagements.id, engagementId))
    .get();
  if (!engagement) throw errors.notFound();
  if (actor.rank < MANAGER_RANK && !(await isAssigned(ctx, engagementId, actor.userId))) {
    // Not assigned: indistinguishable from "doesn't exist".
    throw errors.notFound();
  }
  return { actor, engagement };
}

// --- Clients (organisations) -----------------------------------------------------------------------

const clientInput = z.object({
  name: text(1, 160),
  slug: z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim().toLowerCase()),
  websiteUrl: z
    .string()
    .optional()
    .transform((v) => normaliseUrlInput(v) ?? null)
    .refine((v) => {
      if (v === null) return true;
      try {
        return /^https?:$/.test(new URL(v).protocol);
      } catch {
        return false;
      }
    }, "Enter a full link starting with https://"),
  status: z.enum(["active", "archived"]).optional().default("active"),
});

export async function listClients(
  ctx: ServerContext,
  actorInput: Actor | null,
  filter: { q?: string; status?: "active" | "archived" } = {},
) {
  await authorize(ctx, actorInput, "clients.view");
  const conditions = [eq(schema.clientOrgs.status, filter.status ?? "active")];
  const q = filter.q?.trim().slice(0, 80);
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`${schema.clientOrgs.name} like ${pattern} escape '\\'`);
  }
  const rows = await ctx.db
    .select({
      id: schema.clientOrgs.id,
      name: schema.clientOrgs.name,
      slug: schema.clientOrgs.slug,
      websiteUrl: schema.clientOrgs.websiteUrl,
      status: schema.clientOrgs.status,
      createdAt: schema.clientOrgs.createdAt,
      engagements: sql<number>`(select count(*) from ${schema.engagements} where ${schema.engagements.orgId} = ${schema.clientOrgs.id})`,
      members: sql<number>`(select count(*) from ${schema.clientOrgMembers} where ${schema.clientOrgMembers.orgId} = ${schema.clientOrgs.id})`,
    })
    .from(schema.clientOrgs)
    .where(and(...conditions))
    .orderBy(asc(schema.clientOrgs.name))
    .all();
  return rows.map((r) => ({
    ...r,
    engagements: Number(r.engagements),
    members: Number(r.members),
  }));
}

export async function getClient(ctx: ServerContext, actorInput: Actor | null, orgId: string) {
  const actor = await authorize(ctx, actorInput, "clients.view");
  if (!isId(orgId, "clientOrg")) throw errors.notFound();
  const org = await ctx.db
    .select()
    .from(schema.clientOrgs)
    .where(eq(schema.clientOrgs.id, orgId))
    .get();
  if (!org) throw errors.notFound();
  const [members, engagements, activity] = await Promise.all([
    ctx.db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        status: schema.users.status,
        orgRole: schema.clientOrgMembers.orgRole,
        lastLoginAt: schema.users.lastLoginAt,
      })
      .from(schema.clientOrgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.clientOrgMembers.userId))
      .where(and(eq(schema.clientOrgMembers.orgId, orgId), isNull(schema.users.deletedAt)))
      .orderBy(asc(schema.users.name))
      .all(),
    actor.permissions.has("engagements.view")
      ? listEngagements(ctx, actor, { orgId })
      : Promise.resolve([]),
    actor.permissions.has("audit.view")
      ? activityFor(ctx, "client_org", orgId, 30)
      : Promise.resolve([]),
  ]);
  return { org, members, engagements, activity };
}

export async function saveClient(
  ctx: ServerContext,
  actorInput: Actor | null,
  orgId: string | null,
  input: Record<string, unknown>,
): Promise<string> {
  const actor = await authorize(ctx, actorInput, "clients.manage");
  const parsed = clientInput.safeParse(input);
  if (!parsed.success) {
    throw errors.validation(fieldErrors(parsed.error), "Please check the highlighted fields.");
  }
  const v = parsed.data;
  const slug = v.slug || slugify(v.name);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    throw errors.validation({ slug: "Use lower-case letters, numbers and hyphens." });
  }
  const now = ctx.clock.now();
  try {
    if (!orgId) {
      const id = newId("clientOrg", now);
      await ctx.db.insert(schema.clientOrgs).values({
        id,
        name: v.name,
        slug,
        websiteUrl: v.websiteUrl,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await writeAudit(ctx, actor, {
        action: "client.create",
        targetType: "client_org",
        targetId: id,
        summary: `Created client ${v.name}`,
      });
      return id;
    }
    if (!isId(orgId, "clientOrg")) throw errors.notFound();
    const current = await ctx.db
      .select()
      .from(schema.clientOrgs)
      .where(eq(schema.clientOrgs.id, orgId))
      .get();
    if (!current) throw errors.notFound();
    const next = { name: v.name, slug, websiteUrl: v.websiteUrl, status: v.status };
    await ctx.db
      .update(schema.clientOrgs)
      .set({ ...next, updatedAt: now })
      .where(eq(schema.clientOrgs.id, orgId));
    await writeAudit(ctx, actor, {
      action: "client.update",
      targetType: "client_org",
      targetId: orgId,
      summary: `Updated client ${v.name}`,
      changes: diff(current, next, ["name", "slug", "websiteUrl", "status"]),
    });
    return orgId;
  } catch (error) {
    if (isUniqueViolation(error))
      throw errors.validation({ slug: "That short name is already used." });
    throw error;
  }
}

/** Client accounts that aren't linked to any organisation yet (they see nothing until linked). */
export async function unlinkedClientAccounts(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "clients.view");
  return ctx.db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(
      and(
        eq(schema.roles.key, "client"),
        isNull(schema.users.deletedAt),
        eq(schema.users.status, "active"),
        notInArray(
          schema.users.id,
          ctx.db.select({ id: schema.clientOrgMembers.userId }).from(schema.clientOrgMembers),
        ),
      ),
    )
    .orderBy(desc(schema.users.createdAt))
    .limit(50)
    .all();
}

const ORG_ROLES = ["owner", "member", "viewer"] as const;

/** Gives a client account access to an organisation's projects. */
export async function linkClientUser(
  ctx: ServerContext,
  actorInput: Actor | null,
  orgId: string,
  input: { email: string; orgRole?: string },
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "clients.manage");
  const { org } = await getClient(ctx, actor, orgId);
  const email = emailAddress.safeParse(input.email);
  if (!email.success) throw errors.validation({ email: "Enter the client's email address." });
  const orgRole = ORG_ROLES.includes(input.orgRole as (typeof ORG_ROLES)[number])
    ? (input.orgRole as (typeof ORG_ROLES)[number])
    : "member";
  const user = await ctx.db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(and(eq(schema.users.email, email.data), isNull(schema.users.deletedAt)))
    .get();
  const isClient = user
    ? await ctx.db
        .select({ key: schema.roles.key })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
        .where(and(eq(schema.userRoles.userId, user.id), eq(schema.roles.key, "client")))
        .get()
    : undefined;
  if (!user || !isClient) {
    throw errors.validation({
      email:
        "No Client account uses this address. Invite them from Users, or ask them to create a Client account.",
    });
  }
  await ctx.db
    .insert(schema.clientOrgMembers)
    .values({ orgId, userId: user.id, orgRole, createdAt: ctx.clock.now() })
    .onConflictDoUpdate({
      target: [schema.clientOrgMembers.orgId, schema.clientOrgMembers.userId],
      set: { orgRole },
    });
  await notify(ctx, user.id, {
    type: "client.linked",
    title: `You now have access to ${org.name}`,
    body: "Your projects with VORA appear in your client portal.",
    link: "/client",
  });
  await writeAudit(ctx, actor, {
    action: "client.member.add",
    targetType: "client_org",
    targetId: orgId,
    summary: `Linked ${user.name} to ${org.name}`,
    changes: { userId: user.id, orgRole },
  });
}

export async function unlinkClientUser(
  ctx: ServerContext,
  actorInput: Actor | null,
  orgId: string,
  userId: string,
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "clients.manage");
  if (!isId(orgId, "clientOrg") || !isId(userId, "user")) throw errors.notFound();
  const removed = await ctx.db
    .delete(schema.clientOrgMembers)
    .where(
      and(eq(schema.clientOrgMembers.orgId, orgId), eq(schema.clientOrgMembers.userId, userId)),
    )
    .returning({ userId: schema.clientOrgMembers.userId });
  if (removed.length === 0) throw errors.notFound();
  await writeAudit(ctx, actor, {
    action: "client.member.remove",
    targetType: "client_org",
    targetId: orgId,
    summary: "Removed a person's access to this client",
    changes: { userId },
  });
}

// --- Engagements (client projects) ---------------------------------------------------------------

const date = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null))
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")
      .nullable(),
  );

const engagementInput = z.object({
  name: text(1, 160),
  summary: optionalText(1000).transform((v) => v ?? null),
  status: z.enum(ENGAGEMENT_STATUSES, { error: "Choose a status." }),
  startDate: date,
  targetDate: date,
});

export async function listEngagements(
  ctx: ServerContext,
  actorInput: Actor | null,
  filter: { q?: string; status?: string; orgId?: string } = {},
) {
  const actor = await authorize(ctx, actorInput, "engagements.view");
  const conditions = [];
  if (filter.orgId) conditions.push(eq(schema.engagements.orgId, filter.orgId));
  if (ENGAGEMENT_STATUSES.includes(filter.status as never)) {
    conditions.push(eq(schema.engagements.status, filter.status as never));
  }
  const q = filter.q?.trim().slice(0, 80);
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const match = or(
      sql`${schema.engagements.name} like ${pattern} escape '\\'`,
      sql`${schema.clientOrgs.name} like ${pattern} escape '\\'`,
    );
    if (match) conditions.push(match);
  }
  if (actor.rank < MANAGER_RANK) {
    conditions.push(
      inArray(
        schema.engagements.id,
        ctx.db
          .select({ id: schema.engagementStaff.engagementId })
          .from(schema.engagementStaff)
          .where(eq(schema.engagementStaff.userId, actor.userId)),
      ),
    );
  }
  return ctx.db
    .select({
      id: schema.engagements.id,
      name: schema.engagements.name,
      status: schema.engagements.status,
      orgId: schema.engagements.orgId,
      orgName: schema.clientOrgs.name,
      startDate: schema.engagements.startDate,
      targetDate: schema.engagements.targetDate,
      updatedAt: schema.engagements.updatedAt,
    })
    .from(schema.engagements)
    .innerJoin(schema.clientOrgs, eq(schema.clientOrgs.id, schema.engagements.orgId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.engagements.updatedAt))
    .limit(200)
    .all();
}

export async function getEngagement(ctx: ServerContext, actorInput: Actor | null, id: string) {
  const { actor, engagement } = await engagementFor(ctx, actorInput, id, "view");
  const [org, staff, services, milestones, updates, files, activity] = await Promise.all([
    ctx.db
      .select({ id: schema.clientOrgs.id, name: schema.clientOrgs.name })
      .from(schema.clientOrgs)
      .where(eq(schema.clientOrgs.id, engagement.orgId))
      .get(),
    ctx.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.engagementStaff)
      .innerJoin(schema.users, eq(schema.users.id, schema.engagementStaff.userId))
      .where(eq(schema.engagementStaff.engagementId, id))
      .orderBy(asc(schema.users.name))
      .all(),
    ctx.db
      .select({ id: schema.services.id, name: schema.services.name })
      .from(schema.engagementServices)
      .innerJoin(schema.services, eq(schema.services.id, schema.engagementServices.serviceId))
      .where(eq(schema.engagementServices.engagementId, id))
      .orderBy(asc(schema.services.name))
      .all(),
    ctx.db
      .select()
      .from(schema.milestones)
      .where(eq(schema.milestones.engagementId, id))
      .orderBy(asc(schema.milestones.sortOrder), asc(schema.milestones.createdAt))
      .all(),
    ctx.db
      .select({
        id: schema.engagementMessages.id,
        body: schema.engagementMessages.body,
        visibility: schema.engagementMessages.visibility,
        createdAt: schema.engagementMessages.createdAt,
        authorName: schema.users.name,
        authorId: schema.engagementMessages.authorId,
      })
      .from(schema.engagementMessages)
      .leftJoin(schema.users, eq(schema.users.id, schema.engagementMessages.authorId))
      .where(
        and(
          eq(schema.engagementMessages.engagementId, id),
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
        visibility: schema.engagementFiles.visibility,
        createdAt: schema.engagementFiles.createdAt,
        name: schema.mediaAssets.originalName,
        size: schema.mediaAssets.sizeBytes,
        uploadedByName: schema.users.name,
      })
      .from(schema.engagementFiles)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.engagementFiles.mediaId))
      .leftJoin(schema.users, eq(schema.users.id, schema.engagementFiles.uploadedBy))
      .where(and(eq(schema.engagementFiles.engagementId, id), isNull(schema.mediaAssets.deletedAt)))
      .orderBy(desc(schema.engagementFiles.createdAt))
      .all(),
    activityFor(ctx, "engagement", id, 40),
  ]);
  return {
    engagement,
    org: org ?? { id: engagement.orgId, name: "—" },
    staff,
    services,
    milestones,
    updates,
    files,
    activity,
    can: {
      manage: actor.permissions.has("engagements.manage"),
      assign: actor.permissions.has("clients.manage"),
    },
  };
}

export async function saveEngagement(
  ctx: ServerContext,
  actorInput: Actor | null,
  id: string | null,
  input: Record<string, unknown>,
): Promise<string> {
  const parsed = engagementInput.safeParse(input);
  const now = ctx.clock.now();
  if (!id) {
    const actor = await authorize(ctx, actorInput, "clients.manage");
    await authorize(ctx, actor, "engagements.manage");
    if (!parsed.success) {
      throw errors.validation(fieldErrors(parsed.error), "Please check the highlighted fields.");
    }
    const orgId = String(input.orgId ?? "");
    const org = isId(orgId, "clientOrg")
      ? await ctx.db
          .select({ id: schema.clientOrgs.id, name: schema.clientOrgs.name })
          .from(schema.clientOrgs)
          .where(and(eq(schema.clientOrgs.id, orgId), eq(schema.clientOrgs.status, "active")))
          .get()
      : undefined;
    if (!org) throw errors.validation({ orgId: "Choose the client this project is for." });
    const newEngagementId = newId("engagement", now);
    await ctx.db.insert(schema.engagements).values({
      id: newEngagementId,
      orgId,
      ...parsed.data,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, actor, {
      action: "engagement.create",
      targetType: "engagement",
      targetId: newEngagementId,
      summary: `Created project “${parsed.data.name}” for ${org.name}`,
    });
    return newEngagementId;
  }
  const { actor, engagement } = await engagementFor(ctx, actorInput, id, "manage");
  if (!parsed.success) {
    throw errors.validation(fieldErrors(parsed.error), "Please check the highlighted fields.");
  }
  await ctx.db
    .update(schema.engagements)
    .set({ ...parsed.data, updatedAt: now })
    .where(eq(schema.engagements.id, id));
  const changes = diff(engagement, parsed.data, [
    "name",
    "summary",
    "status",
    "startDate",
    "targetDate",
  ]);
  await writeAudit(ctx, actor, {
    action: "engagement.update",
    targetType: "engagement",
    targetId: id,
    summary: changes.status
      ? `Status: ${engagement.status} → ${parsed.data.status}`
      : `Updated project “${parsed.data.name}”`,
    changes,
  });
  if (changes.status) {
    await notifyClients(ctx, id, {
      type: "engagement.status",
      title: `${parsed.data.name}: status updated`,
      body: `Now: ${parsed.data.status.replace("_", " ")}.`,
    });
  }
  return id;
}

/** People who can be assigned to projects (active, with engagements.view). */
export async function staffOptions(ctx: ServerContext) {
  const ids = await activeUsersWithPermission(ctx, "engagements.view");
  if (ids.length === 0) return [];
  return ctx.db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, ids))
    .orderBy(asc(schema.users.name))
    .all();
}

export async function serviceOptions(ctx: ServerContext) {
  return ctx.db
    .select({ id: schema.services.id, name: schema.services.name })
    .from(schema.services)
    .where(isNull(schema.services.archivedAt))
    .orderBy(asc(schema.services.sortOrder), asc(schema.services.name))
    .all();
}

export async function setEngagementStaff(
  ctx: ServerContext,
  actorInput: Actor | null,
  id: string,
  userIds: string[],
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "clients.manage");
  const { engagement } = await engagementFor(ctx, actor, id, "manage");
  const wanted = [...new Set(userIds.filter((u) => isId(u, "user")))];
  const allowed = new Set(await activeUsersWithPermission(ctx, "engagements.view"));
  const invalid = wanted.filter((u) => !allowed.has(u));
  if (invalid.length > 0)
    throw errors.validation({ staff: "Only VORA team members can be assigned." });
  const current = (
    await ctx.db
      .select({ userId: schema.engagementStaff.userId })
      .from(schema.engagementStaff)
      .where(eq(schema.engagementStaff.engagementId, id))
      .all()
  ).map((r) => r.userId);
  const added = wanted.filter((u) => !current.includes(u));
  const removed = current.filter((u) => !wanted.includes(u));
  const now = ctx.clock.now();
  if (removed.length > 0) {
    await ctx.db
      .delete(schema.engagementStaff)
      .where(
        and(
          eq(schema.engagementStaff.engagementId, id),
          inArray(schema.engagementStaff.userId, removed),
        ),
      );
  }
  if (added.length > 0) {
    await ctx.db
      .insert(schema.engagementStaff)
      .values(added.map((userId) => ({ engagementId: id, userId, createdAt: now })))
      .onConflictDoNothing();
    await notify(
      ctx,
      added.filter((u) => u !== actor.userId),
      {
        type: "engagement.assigned",
        title: `You've been added to ${engagement.name}`,
        link: `/admin/engagements/${id}`,
      },
    );
  }
  await writeAudit(ctx, actor, {
    action: "engagement.staff",
    targetType: "engagement",
    targetId: id,
    summary: `Team updated (${added.length} added, ${removed.length} removed)`,
    changes: { added, removed },
  });
}

export async function setEngagementServices(
  ctx: ServerContext,
  actorInput: Actor | null,
  id: string,
  serviceIds: string[],
): Promise<void> {
  const { actor } = await engagementFor(ctx, actorInput, id, "manage");
  const wanted = [...new Set(serviceIds.filter((s) => isId(s, "service")))];
  if (wanted.length > 0) {
    const found = await ctx.db
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(inArray(schema.services.id, wanted))
      .all();
    if (found.length !== wanted.length) throw errors.validation({ services: "Unknown service." });
  }
  await ctx.db
    .delete(schema.engagementServices)
    .where(eq(schema.engagementServices.engagementId, id));
  if (wanted.length > 0) {
    const now = ctx.clock.now();
    await ctx.db
      .insert(schema.engagementServices)
      .values(wanted.map((serviceId) => ({ engagementId: id, serviceId, createdAt: now })));
  }
  await writeAudit(ctx, actor, {
    action: "engagement.services",
    targetType: "engagement",
    targetId: id,
    summary: `Services set (${wanted.length})`,
    changes: { services: wanted },
  });
}

// --- Milestones ------------------------------------------------------------------------------------

const milestoneInput = z.object({
  title: text(1, 160),
  description: optionalText(1000).transform((v) => v ?? null),
  dueDate: date,
  status: z.enum(MILESTONE_STATUSES, { error: "Choose a status." }),
});

export async function saveMilestone(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  milestoneId: string | null,
  input: Record<string, unknown>,
): Promise<void> {
  const { actor, engagement } = await engagementFor(ctx, actorInput, engagementId, "manage");
  const parsed = milestoneInput.safeParse(input);
  if (!parsed.success) {
    throw errors.validation(fieldErrors(parsed.error), "Please check the milestone.");
  }
  const v = parsed.data;
  const now = ctx.clock.now();
  if (!milestoneId) {
    const position = await ctx.db
      .select({ n: count() })
      .from(schema.milestones)
      .where(eq(schema.milestones.engagementId, engagementId))
      .get();
    await ctx.db.insert(schema.milestones).values({
      id: newId("milestone", now),
      engagementId,
      ...v,
      sortOrder: Number(position?.n ?? 0),
      completedAt: v.status === "done" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, actor, {
      action: "engagement.milestone.add",
      targetType: "engagement",
      targetId: engagementId,
      summary: `Milestone added: ${v.title}`,
    });
    return;
  }
  if (!isId(milestoneId, "milestone")) throw errors.notFound();
  const current = await ctx.db
    .select()
    .from(schema.milestones)
    .where(
      and(eq(schema.milestones.id, milestoneId), eq(schema.milestones.engagementId, engagementId)),
    )
    .get();
  if (!current) throw errors.notFound();
  await ctx.db
    .update(schema.milestones)
    .set({
      ...v,
      completedAt: v.status === "done" ? (current.completedAt ?? now) : null,
      updatedAt: now,
    })
    .where(eq(schema.milestones.id, milestoneId));
  await writeAudit(ctx, actor, {
    action: "engagement.milestone.update",
    targetType: "engagement",
    targetId: engagementId,
    summary: `Milestone ${v.title}: ${current.status} → ${v.status}`,
    changes: diff(current, v, ["title", "dueDate", "status"]),
  });
  if (current.status !== "done" && v.status === "done") {
    await notifyClients(ctx, engagementId, {
      type: "engagement.milestone",
      title: `${engagement.name}: “${v.title}” is done`,
    });
  }
}

export async function deleteMilestone(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  milestoneId: string,
): Promise<void> {
  const { actor } = await engagementFor(ctx, actorInput, engagementId, "manage");
  if (!isId(milestoneId, "milestone")) throw errors.notFound();
  const removed = await ctx.db
    .delete(schema.milestones)
    .where(
      and(eq(schema.milestones.id, milestoneId), eq(schema.milestones.engagementId, engagementId)),
    )
    .returning({ title: schema.milestones.title });
  if (removed.length === 0) throw errors.notFound();
  await writeAudit(ctx, actor, {
    action: "engagement.milestone.delete",
    targetType: "engagement",
    targetId: engagementId,
    summary: `Milestone removed: ${removed[0]?.title ?? ""}`,
  });
}

// --- Updates (messages) ------------------------------------------------------------------------------

const VISIBILITY = ["client", "internal"] as const;

/** Clients linked to the engagement's organisation (for notifications). */
async function clientUserIds(ctx: ServerContext, engagementId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: schema.clientOrgMembers.userId })
    .from(schema.clientOrgMembers)
    .innerJoin(schema.engagements, eq(schema.engagements.orgId, schema.clientOrgMembers.orgId))
    .innerJoin(schema.users, eq(schema.users.id, schema.clientOrgMembers.userId))
    .where(and(eq(schema.engagements.id, engagementId), eq(schema.users.status, "active")))
    .all();
  return rows.map((r) => r.id);
}

async function notifyClients(
  ctx: ServerContext,
  engagementId: string,
  input: { type: string; title: string; body?: string },
) {
  const ids = await clientUserIds(ctx, engagementId);
  await notify(ctx, ids, { ...input, link: `/client/projects/${engagementId}` });
}

export async function postEngagementUpdate(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  input: { body: string; visibility: string },
): Promise<void> {
  const { actor, engagement } = await engagementFor(ctx, actorInput, engagementId, "manage");
  const body = input.body.trim();
  if (body.length < 1 || body.length > 10_000) {
    throw errors.validation({ body: "Write an update (up to 10,000 characters)." });
  }
  const visibility = VISIBILITY.includes(input.visibility as never)
    ? (input.visibility as (typeof VISIBILITY)[number])
    : "internal";
  const now = ctx.clock.now();
  const id = newId("message", now);
  await ctx.db.insert(schema.engagementMessages).values({
    id,
    engagementId,
    authorId: actor.userId,
    body,
    visibility,
    createdAt: now,
  });
  await ctx.db
    .update(schema.engagements)
    .set({ updatedAt: now })
    .where(eq(schema.engagements.id, engagementId));
  await writeAudit(ctx, actor, {
    action: "engagement.update.post",
    targetType: "engagement",
    targetId: engagementId,
    summary: visibility === "client" ? "Posted an update for the client" : "Added an internal note",
    changes: { messageId: id, visibility },
  });
  if (visibility === "client") {
    await notifyClients(ctx, engagementId, {
      type: "engagement.update",
      title: `New update on ${engagement.name}`,
    });
  }
}

// --- Files -------------------------------------------------------------------------------------------

export async function uploadEngagementFile(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  input: { file: File | null; label: string; visibility: string },
): Promise<string> {
  const { actor, engagement } = await engagementFor(ctx, actorInput, engagementId, "manage");
  const upload = await validateUpload(input.file);
  const label = (input.label.trim() || upload.name).slice(0, 160);
  const visibility = VISIBILITY.includes(input.visibility as never)
    ? (input.visibility as (typeof VISIBILITY)[number])
    : "internal";
  const now = ctx.clock.now();
  const mediaId = newId("media", now);
  const fileId = newId("engagementFile", now);
  // The storage key is made of ids only — never the uploaded name.
  const storageKey = `engagements/${engagementId}/${fileId}`;
  const checksum = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", upload.bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  await ctx.env.PRIVATE.put(storageKey, upload.bytes, {
    httpMetadata: { contentType: upload.type.mime },
  });
  try {
    await ctx.db.insert(schema.mediaAssets).values({
      id: mediaId,
      bucket: "private",
      storageKey,
      kind:
        upload.type.kind === "archive"
          ? "other"
          : upload.type.kind === "image" || upload.type.kind === "video"
            ? upload.type.kind
            : "document",
      mimeType: upload.type.mime,
      originalName: upload.name,
      sizeBytes: upload.bytes.byteLength,
      checksumSha256: checksum,
      status: "ready",
      uploadedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.engagementFiles).values({
      id: fileId,
      engagementId,
      mediaId,
      visibility,
      label,
      uploadedBy: actor.userId,
      createdAt: now,
    });
  } catch (error) {
    await ctx.env.PRIVATE.delete(storageKey).catch(() => undefined);
    throw error;
  }
  await writeAudit(ctx, actor, {
    action: "engagement.file.upload",
    targetType: "engagement",
    targetId: engagementId,
    summary: `Uploaded “${label}” (${visibility === "client" ? "shared with client" : "internal"})`,
    changes: { fileId, mime: upload.type.mime, size: upload.bytes.byteLength },
  });
  if (visibility === "client") {
    await notifyClients(ctx, engagementId, {
      type: "engagement.file",
      title: `New file on ${engagement.name}`,
      body: label,
    });
  }
  return fileId;
}

async function loadFile(ctx: ServerContext, fileId: string) {
  if (!isId(fileId, "engagementFile")) throw errors.notFound();
  const row = await ctx.db
    .select({
      id: schema.engagementFiles.id,
      engagementId: schema.engagementFiles.engagementId,
      visibility: schema.engagementFiles.visibility,
      label: schema.engagementFiles.label,
      mediaId: schema.mediaAssets.id,
      storageKey: schema.mediaAssets.storageKey,
      name: schema.mediaAssets.originalName,
      mime: schema.mediaAssets.mimeType,
      size: schema.mediaAssets.sizeBytes,
      deletedAt: schema.mediaAssets.deletedAt,
      bucket: schema.mediaAssets.bucket,
    })
    .from(schema.engagementFiles)
    .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.engagementFiles.mediaId))
    .where(eq(schema.engagementFiles.id, fileId))
    .get();
  if (!row || row.deletedAt || row.bucket !== "private") throw errors.notFound();
  return row;
}

export async function setFileVisibility(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  fileId: string,
  visibility: string,
): Promise<void> {
  const { actor, engagement } = await engagementFor(ctx, actorInput, engagementId, "manage");
  const file = await loadFile(ctx, fileId);
  if (file.engagementId !== engagementId) throw errors.notFound();
  const next = visibility === "client" ? "client" : "internal";
  await ctx.db
    .update(schema.engagementFiles)
    .set({ visibility: next })
    .where(eq(schema.engagementFiles.id, fileId));
  await writeAudit(ctx, actor, {
    action: "engagement.file.visibility",
    targetType: "engagement",
    targetId: engagementId,
    summary: `“${file.label}” is now ${next === "client" ? "shared with the client" : "internal"}`,
    changes: { fileId, visibility: { from: file.visibility, to: next } },
  });
  if (next === "client" && file.visibility !== "client") {
    await notifyClients(ctx, engagementId, {
      type: "engagement.file",
      title: `New file on ${engagement.name}`,
      body: file.label,
    });
  }
}

export async function deleteEngagementFile(
  ctx: ServerContext,
  actorInput: Actor | null,
  engagementId: string,
  fileId: string,
): Promise<void> {
  const { actor } = await engagementFor(ctx, actorInput, engagementId, "manage");
  const file = await loadFile(ctx, fileId);
  if (file.engagementId !== engagementId) throw errors.notFound();
  const now = ctx.clock.now();
  await ctx.db.delete(schema.engagementFiles).where(eq(schema.engagementFiles.id, fileId));
  await ctx.db
    .update(schema.mediaAssets)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(schema.mediaAssets.id, file.mediaId));
  await ctx.env.PRIVATE.delete(file.storageKey);
  await writeAudit(ctx, actor, {
    action: "engagement.file.delete",
    targetType: "engagement",
    targetId: engagementId,
    summary: `Deleted “${file.label}”`,
    changes: { fileId },
  });
}

/**
 * Opens a private file for download after the policy check:
 * - VORA staff with access to the engagement (Managers+, or assigned Staff): any file.
 * - Clients: only files shared with the client, on their own organisation's engagements.
 * Everything else is a 404, so ids reveal nothing.
 */
export async function openEngagementFile(
  ctx: ServerContext,
  actorInput: Actor | null,
  fileId: string,
) {
  if (!actorInput) throw errors.unauthenticated();
  const file = await loadFile(ctx, fileId);
  let allowed = false;
  if (actorInput.permissions.has("engagements.view")) {
    allowed =
      actorInput.rank >= MANAGER_RANK ||
      (await isAssigned(ctx, file.engagementId, actorInput.userId));
  } else if (actorInput.permissions.has("client_portal.access") && file.visibility === "client") {
    const member = await ctx.db
      .select({ id: schema.engagements.id })
      .from(schema.engagements)
      .innerJoin(
        schema.clientOrgMembers,
        eq(schema.clientOrgMembers.orgId, schema.engagements.orgId),
      )
      .where(
        and(
          eq(schema.engagements.id, file.engagementId),
          eq(schema.clientOrgMembers.userId, actorInput.userId),
        ),
      )
      .get();
    allowed = Boolean(member);
  }
  if (!allowed) throw errors.notFound();
  const object = await ctx.env.PRIVATE.get(file.storageKey);
  if (!object) throw errors.notFound();
  return { object, name: file.name, mime: file.mime, size: object.size };
}
