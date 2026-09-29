import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";

/**
 * THE public read path for CMS content. It only ever reads immutable published snapshots
 * (`content_versions` joined through `published_version_id` with status = published). Working-copy
 * columns are never selected here, so an unfinished draft cannot reach a public page.
 */

export interface PublishedProjectSummary {
  slug: string;
  title: string;
  category: string | null;
  summary: string | null;
  year: number | null;
  clientName: string | null;
  coverMediaId: string | null;
  isFeatured: boolean;
}

type Snapshot = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

function toProjectSummary(snapshot: Snapshot, isFeatured: boolean): PublishedProjectSummary {
  return {
    slug: String(snapshot.slug ?? ""),
    title: String(snapshot.title ?? ""),
    category: str(snapshot.category),
    summary: str(snapshot.summary),
    year: num(snapshot.year),
    clientName: str(snapshot.clientName),
    coverMediaId: str(snapshot.coverMediaId),
    isFeatured,
  };
}

export async function listPublishedProjects(
  ctx: ServerContext,
): Promise<PublishedProjectSummary[]> {
  const rows = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot, isFeatured: schema.projects.isFeatured })
    .from(schema.projects)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.projects.publishedVersionId),
    )
    .where(
      and(eq(schema.projects.status, "published"), isNotNull(schema.projects.publishedVersionId)),
    )
    .orderBy(asc(schema.projects.sortOrder), asc(schema.projects.publishedAt))
    .all();
  return rows.map((r) => toProjectSummary(r.snapshot, r.isFeatured));
}

export async function getPublishedProject(
  ctx: ServerContext,
  slug: string,
): Promise<Snapshot | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  const row = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot })
    .from(schema.projects)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.projects.publishedVersionId),
    )
    .where(and(eq(schema.projects.slug, slug), eq(schema.projects.status, "published")))
    .get();
  return row?.snapshot ?? null;
}

export async function listPublishedServices(ctx: ServerContext) {
  const rows = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot })
    .from(schema.services)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.services.publishedVersionId),
    )
    .where(eq(schema.services.status, "published"))
    .orderBy(asc(schema.services.sortOrder))
    .all();
  return rows.map((r) => r.snapshot);
}

export async function getPublishedService(
  ctx: ServerContext,
  slug: string,
): Promise<Snapshot | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  const row = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot })
    .from(schema.services)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.services.publishedVersionId),
    )
    .where(and(eq(schema.services.slug, slug), eq(schema.services.status, "published")))
    .get();
  return row?.snapshot ?? null;
}

export async function getPublishedPage(ctx: ServerContext, key: string): Promise<Snapshot | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) return null;
  const row = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot })
    .from(schema.pages)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.pages.publishedVersionId),
    )
    .where(and(eq(schema.pages.key, key), eq(schema.pages.status, "published")))
    .get();
  return row?.snapshot ?? null;
}

export async function listPublishedPartners(ctx: ServerContext) {
  const rows = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot })
    .from(schema.partners)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.partners.publishedVersionId),
    )
    .where(eq(schema.partners.status, "published"))
    .orderBy(asc(schema.partners.sortOrder))
    .all();
  return rows.map((r) => r.snapshot);
}

export async function listOpenRoles(ctx: ServerContext) {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot, closesAt: schema.jobRoles.closesAt })
    .from(schema.jobRoles)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.jobRoles.publishedVersionId),
    )
    .where(eq(schema.jobRoles.status, "open"))
    .orderBy(asc(schema.jobRoles.sortOrder))
    .all();
  return rows.filter((r) => !r.closesAt || r.closesAt > now).map((r) => r.snapshot);
}

export async function listVisibleSocialLinks(ctx: ServerContext, placement?: string) {
  const rows = await ctx.db
    .select({
      platform: schema.socialLinks.platform,
      label: schema.socialLinks.label,
      url: schema.socialLinks.url,
      handle: schema.socialLinks.handle,
      placements: schema.socialLinks.placements,
    })
    .from(schema.socialLinks)
    .where(eq(schema.socialLinks.isVisible, true))
    .orderBy(asc(schema.socialLinks.sortOrder))
    .all();
  return placement ? rows.filter((r) => r.placements.includes(placement)) : rows;
}

/**
 * Which published services each published project used (the case study's Services fact and a
 * service page's related work). Both sides must be published; names come from the published
 * service snapshot, never the working copy.
 */
export async function listPublishedProjectServices(
  ctx: ServerContext,
): Promise<{ projectSlug: string; serviceSlug: string; serviceName: string }[]> {
  const rows = await ctx.db
    .select({
      projectSlug: schema.projects.slug,
      snapshot: schema.contentVersions.snapshot,
    })
    .from(schema.projectServices)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectServices.projectId))
    .innerJoin(schema.services, eq(schema.services.id, schema.projectServices.serviceId))
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.services.publishedVersionId),
    )
    .where(
      and(
        eq(schema.projects.status, "published"),
        isNotNull(schema.projects.publishedVersionId),
        eq(schema.services.status, "published"),
      ),
    )
    .orderBy(asc(schema.services.sortOrder))
    .all();
  return rows
    .map((r) => ({
      projectSlug: r.projectSlug,
      serviceSlug: String(r.snapshot.slug ?? ""),
      serviceName: String(r.snapshot.name ?? ""),
    }))
    .filter((r) => r.serviceSlug && r.serviceName);
}

/** The published services delivered with a published partner (the Partners page). */
export async function listPublishedServicesForPartner(
  ctx: ServerContext,
  partnerSlug: string,
): Promise<Snapshot[]> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(partnerSlug)) return [];
  const rows = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot })
    .from(schema.services)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.services.partnerId))
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.services.publishedVersionId),
    )
    .where(
      and(
        eq(schema.services.status, "published"),
        eq(schema.partners.status, "published"),
        eq(schema.partners.slug, partnerSlug),
      ),
    )
    .orderBy(asc(schema.services.sortOrder))
    .all();
  return rows.map((r) => r.snapshot);
}

/** A published page with the time it was published ("Last updated" on the legal pages). */
export async function getPublishedPageEntry(
  ctx: ServerContext,
  key: string,
): Promise<{ snapshot: Snapshot; publishedAt: number | null } | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) return null;
  const row = await ctx.db
    .select({ snapshot: schema.contentVersions.snapshot, publishedAt: schema.pages.publishedAt })
    .from(schema.pages)
    .innerJoin(
      schema.contentVersions,
      eq(schema.contentVersions.id, schema.pages.publishedVersionId),
    )
    .where(and(eq(schema.pages.key, key), eq(schema.pages.status, "published")))
    .get();
  return row ? { snapshot: row.snapshot, publishedAt: row.publishedAt } : null;
}
