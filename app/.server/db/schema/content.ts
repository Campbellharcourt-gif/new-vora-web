import type { ContentBlock } from "@shared/content/blocks";
import { CONTENT_STATUSES, JOB_ROLE_STATUSES, SERVICE_DELIVERY_MODELS } from "@shared/enums";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { inList, isBool, isJson } from "./_helpers";
import { users } from "./identity";
import { mediaAssets } from "./media";

/**
 * Publishable content. Each row is the editable WORKING COPY. What the public sees is the
 * immutable snapshot in `content_versions` referenced by `published_version_id` — public routes
 * never read working-copy columns (see published-content repository).
 */

const slugCheck = (column: AnySQLiteColumn) =>
  sql`${column} glob '[a-z0-9]*' and ${column} not glob '*[^a-z0-9-]*' and length(${column}) between 1 and 80`;

export interface Credit {
  role: string;
  name: string;
  organisation?: string;
  url?: string;
}

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("draft"),
    title: text("title").notNull(),
    category: text("category"),
    summary: text("summary"),
    body: text("body", { mode: "json" }).$type<ContentBlock[]>().notNull(),
    year: integer("year"),
    clientName: text("client_name"),
    clientOrgId: text("client_org_id"),
    credits: text("credits", { mode: "json" }).$type<Credit[]>().notNull(),
    externalUrl: text("external_url"),
    coverMediaId: text("cover_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ogMediaId: text("og_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    isFeatured: integer("is_featured", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedVersionId: text("published_version_id"),
    publishedAt: integer("published_at"),
    hasUnpublishedChanges: integer("has_unpublished_changes", { mode: "boolean" })
      .notNull()
      .default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    uniqueIndex("projects_slug_uq").on(t.slug),
    index("projects_status_order_idx").on(t.status, t.sortOrder),
    index("projects_featured_idx").on(t.isFeatured, t.status),
    check("projects_status_ck", inList(t.status, CONTENT_STATUSES)),
    check("projects_slug_ck", slugCheck(t.slug)),
    check("projects_year_ck", sql`${t.year} is null or ${t.year} between 1990 and 2100`),
    check("projects_body_ck", isJson(t.body)),
    check("projects_credits_ck", isJson(t.credits)),
    check("projects_featured_ck", isBool(t.isFeatured)),
    check(
      "projects_published_has_version_ck",
      sql`${t.status} != 'published' or ${t.publishedVersionId} is not null`,
    ),
    check(
      "projects_external_url_ck",
      sql`${t.externalUrl} is null or ${t.externalUrl} like 'https://%' or ${t.externalUrl} like 'http://%'`,
    ),
  ],
);

export const projectMedia = sqliteTable(
  "project_media",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
    caption: text("caption"),
    altOverride: text("alt_override"),
    layout: text("layout", { enum: ["inline", "wide", "full"] })
      .notNull()
      .default("inline"),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.mediaId] }),
    check("project_media_layout_ck", inList(t.layout, ["inline", "wide", "full"])),
  ],
);

export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("draft"),
    name: text("name").notNull(),
    summary: text("summary"),
    body: text("body", { mode: "json" }).$type<ContentBlock[]>().notNull(),
    deliveryModel: text("delivery_model", { enum: SERVICE_DELIVERY_MODELS }).notNull(),
    partnerId: text("partner_id"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedVersionId: text("published_version_id"),
    publishedAt: integer("published_at"),
    hasUnpublishedChanges: integer("has_unpublished_changes", { mode: "boolean" })
      .notNull()
      .default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    uniqueIndex("services_slug_uq").on(t.slug),
    index("services_status_order_idx").on(t.status, t.sortOrder),
    check("services_status_ck", inList(t.status, CONTENT_STATUSES)),
    check("services_slug_ck", slugCheck(t.slug)),
    check("services_delivery_ck", inList(t.deliveryModel, SERVICE_DELIVERY_MODELS)),
    check("services_body_ck", isJson(t.body)),
    check(
      "services_partner_model_ck",
      sql`${t.deliveryModel} = 'vora' or ${t.partnerId} is not null`,
    ),
    check(
      "services_published_has_version_ck",
      sql`${t.status} != 'published' or ${t.publishedVersionId} is not null`,
    ),
  ],
);

export const projectServices = sqliteTable(
  "project_services",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.serviceId] }),
    index("project_services_service_idx").on(t.serviceId),
  ],
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("draft"),
    title: text("title").notNull(),
    intro: text("intro"),
    body: text("body", { mode: "json" }).$type<ContentBlock[]>().notNull(),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    publishedVersionId: text("published_version_id"),
    publishedAt: integer("published_at"),
    hasUnpublishedChanges: integer("has_unpublished_changes", { mode: "boolean" })
      .notNull()
      .default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    uniqueIndex("pages_key_uq").on(t.key),
    check("pages_status_ck", inList(t.status, CONTENT_STATUSES)),
    check("pages_key_ck", slugCheck(t.key)),
    check("pages_body_ck", isJson(t.body)),
    check(
      "pages_published_has_version_ck",
      sql`${t.status} != 'published' or ${t.publishedVersionId} is not null`,
    ),
  ],
);

export const partners = sqliteTable(
  "partners",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("draft"),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    description: text("description"),
    statement: text("statement"),
    url: text("url"),
    logoMediaId: text("logo_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedVersionId: text("published_version_id"),
    publishedAt: integer("published_at"),
    hasUnpublishedChanges: integer("has_unpublished_changes", { mode: "boolean" })
      .notNull()
      .default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    uniqueIndex("partners_slug_uq").on(t.slug),
    check("partners_status_ck", inList(t.status, CONTENT_STATUSES)),
    check("partners_slug_ck", slugCheck(t.slug)),
    check("partners_url_ck", sql`${t.url} is null or ${t.url} like 'https://%'`),
    check(
      "partners_published_has_version_ck",
      sql`${t.status} != 'published' or ${t.publishedVersionId} is not null`,
    ),
  ],
);

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
] as const;
export const LOCATION_TYPES = ["remote", "hybrid", "onsite"] as const;

export const jobRoles = sqliteTable(
  "job_roles",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    status: text("status", { enum: JOB_ROLE_STATUSES }).notNull().default("draft"),
    title: text("title").notNull(),
    department: text("department"),
    employmentType: text("employment_type", { enum: EMPLOYMENT_TYPES }),
    locationType: text("location_type", { enum: LOCATION_TYPES }),
    locationText: text("location_text"),
    summary: text("summary"),
    body: text("body", { mode: "json" }).$type<ContentBlock[]>().notNull(),
    applicationMode: text("application_mode", { enum: ["form", "email", "external"] })
      .notNull()
      .default("form"),
    externalUrl: text("external_url"),
    opensAt: integer("opens_at"),
    closesAt: integer("closes_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedVersionId: text("published_version_id"),
    publishedAt: integer("published_at"),
    hasUnpublishedChanges: integer("has_unpublished_changes", { mode: "boolean" })
      .notNull()
      .default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    uniqueIndex("job_roles_slug_uq").on(t.slug),
    index("job_roles_status_idx").on(t.status, t.sortOrder),
    check("job_roles_status_ck", inList(t.status, JOB_ROLE_STATUSES)),
    check("job_roles_slug_ck", slugCheck(t.slug)),
    check("job_roles_body_ck", isJson(t.body)),
    check(
      "job_roles_employment_ck",
      sql`${t.employmentType} is null or ${inList(t.employmentType, EMPLOYMENT_TYPES)}`,
    ),
    check(
      "job_roles_location_ck",
      sql`${t.locationType} is null or ${inList(t.locationType, LOCATION_TYPES)}`,
    ),
    check("job_roles_mode_ck", inList(t.applicationMode, ["form", "email", "external"])),
    check(
      "job_roles_open_has_version_ck",
      sql`${t.status} != 'open' or ${t.publishedVersionId} is not null`,
    ),
  ],
);

export const CONTENT_ENTITY_TYPES = ["project", "service", "page", "partner", "job_role"] as const;
export type ContentEntityType = (typeof CONTENT_ENTITY_TYPES)[number];

export const contentVersions = sqliteTable(
  "content_versions",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type", { enum: CONTENT_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind", { enum: ["draft", "published", "restored"] }).notNull(),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("content_versions_entity_version_uq").on(t.entityType, t.entityId, t.version),
    index("content_versions_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    check("content_versions_entity_ck", inList(t.entityType, CONTENT_ENTITY_TYPES)),
    check("content_versions_kind_ck", inList(t.kind, ["draft", "published", "restored"])),
    check("content_versions_snapshot_ck", isJson(t.snapshot)),
    check("content_versions_version_ck", sql`${t.version} >= 1`),
  ],
);

export const previewTokens = sqliteTable(
  "preview_tokens",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type", { enum: CONTENT_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    versionId: text("version_id").references(() => contentVersions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("preview_tokens_hash_uq").on(t.tokenHash),
    index("preview_tokens_entity_idx").on(t.entityType, t.entityId),
    check("preview_tokens_entity_ck", inList(t.entityType, CONTENT_ENTITY_TYPES)),
  ],
);

export const slugRedirects = sqliteTable(
  "slug_redirects",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type", { enum: CONTENT_ENTITY_TYPES }).notNull(),
    fromSlug: text("from_slug").notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("slug_redirects_from_uq").on(t.entityType, t.fromSlug),
    check("slug_redirects_entity_ck", inList(t.entityType, CONTENT_ENTITY_TYPES)),
  ],
);
