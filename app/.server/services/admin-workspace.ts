import { count, desc, eq, inArray, isNull } from "drizzle-orm";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { SETTINGS, getSetting } from "./settings";

export async function adminOverview(ctx: ServerContext, actorInput: Actor | null) {
  const actor = await authorize(ctx, actorInput, "admin.access");
  const [projects, services, pages, clients, engagements, enquiries, users, security, audit] =
    await Promise.all([
      actor.permissions.has("projects.view")
        ? ctx.db.select({ n: count() }).from(schema.projects).where(isNull(schema.projects.archivedAt)).get()
        : null,
      actor.permissions.has("services.view")
        ? ctx.db.select({ n: count() }).from(schema.services).where(isNull(schema.services.archivedAt)).get()
        : null,
      actor.permissions.has("pages.view")
        ? ctx.db.select({ n: count() }).from(schema.pages).where(isNull(schema.pages.archivedAt)).get()
        : null,
      actor.permissions.has("clients.view")
        ? ctx.db.select({ n: count() }).from(schema.clientOrgs).where(eq(schema.clientOrgs.status, "active")).get()
        : null,
      actor.permissions.has("engagements.view")
        ? ctx.db.select({ n: count() }).from(schema.engagements).where(inArray(schema.engagements.status, ["planning", "in_progress", "review"])).get()
        : null,
      actor.permissions.has("enquiries.view")
        ? ctx.db.select({ n: count() }).from(schema.enquiries).where(isNull(schema.enquiries.deletedAt)).get()
        : null,
      actor.permissions.has("users.view")
        ? ctx.db.select({ n: count() }).from(schema.users).where(isNull(schema.users.deletedAt)).get()
        : null,
      actor.permissions.has("security.view")
        ? ctx.db.select({ n: count() }).from(schema.securityEvents).get()
        : null,
      actor.permissions.has("audit.view")
        ? ctx.db.select({ n: count() }).from(schema.auditLogs).get()
        : null,
    ]);
  return {
    counts: {
      projects: projects?.n ?? null,
      services: services?.n ?? null,
      pages: pages?.n ?? null,
      clients: clients?.n ?? null,
      engagements: engagements?.n ?? null,
      enquiries: enquiries?.n ?? null,
      users: users?.n ?? null,
      security: security?.n ?? null,
      audit: audit?.n ?? null,
    },
  };
}

export async function listAdminClients(ctx: ServerContext, actorInput: Actor | null) {
  const actor = await authorize(ctx, actorInput, "clients.view");
  const rows = await ctx.db
    .select({
      id: schema.clientOrgs.id,
      name: schema.clientOrgs.name,
      slug: schema.clientOrgs.slug,
      websiteUrl: schema.clientOrgs.websiteUrl,
      status: schema.clientOrgs.status,
      createdAt: schema.clientOrgs.createdAt,
      engagements: count(schema.engagements.id),
    })
    .from(schema.clientOrgs)
    .leftJoin(schema.engagements, eq(schema.engagements.orgId, schema.clientOrgs.id))
    .groupBy(schema.clientOrgs.id)
    .orderBy(desc(schema.clientOrgs.createdAt))
    .all();
  return rows;
}

export async function listAdminProjects(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "projects.view");
  return ctx.db
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      title: schema.projects.title,
      category: schema.projects.category,
      status: schema.projects.status,
      year: schema.projects.year,
      clientName: schema.projects.clientName,
      isFeatured: schema.projects.isFeatured,
      hasUnpublishedChanges: schema.projects.hasUnpublishedChanges,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt))
    .orderBy(desc(schema.projects.updatedAt))
    .all();
}

export async function listAdminServices(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "services.view");
  return ctx.db
    .select({
      id: schema.services.id,
      slug: schema.services.slug,
      name: schema.services.name,
      summary: schema.services.summary,
      status: schema.services.status,
      deliveryModel: schema.services.deliveryModel,
      hasUnpublishedChanges: schema.services.hasUnpublishedChanges,
      updatedAt: schema.services.updatedAt,
    })
    .from(schema.services)
    .where(isNull(schema.services.archivedAt))
    .orderBy(schema.services.sortOrder, desc(schema.services.updatedAt))
    .all();
}

export async function contentOverview(ctx: ServerContext, actorInput: Actor | null) {
  const actor = await authorize(ctx, actorInput, "admin.access");
  const result = await adminOverview(ctx, actor);
  return result.counts;
}

export async function listSecurityEvents(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "security.view");
  return ctx.db
    .select()
    .from(schema.securityEvents)
    .orderBy(desc(schema.securityEvents.createdAt))
    .limit(100)
    .all();
}

export async function listAuditLogs(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "audit.view");
  return ctx.db
    .select()
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(100)
    .all();
}

export async function settingsOverview(ctx: ServerContext, actorInput: Actor | null) {
  const actor = await authorize(ctx, actorInput, "settings.view");
  const entries = [];
  for (const key of Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]) {
    entries.push({ key, value: await getSetting(ctx, key), canManage: actor.permissions.has("settings.manage") });
  }
  return entries;
}
