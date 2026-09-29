import { ENGAGEMENT_STATUSES } from "@shared/enums";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { inList, isJson } from "./_helpers";
import { projects } from "./content";
import { users } from "./identity";
import { mediaAssets } from "./media";

export const clientOrgs = sqliteTable(
  "client_orgs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    websiteUrl: text("website_url"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("client_orgs_slug_uq").on(t.slug),
    check("client_orgs_status_ck", inList(t.status, ["active", "archived"])),
  ],
);

export const clientOrgMembers = sqliteTable(
  "client_org_members",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => clientOrgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgRole: text("org_role", { enum: ["owner", "member", "viewer"] })
      .notNull()
      .default("member"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index("client_org_members_user_idx").on(t.userId),
    check("client_org_members_role_ck", inList(t.orgRole, ["owner", "member", "viewer"])),
  ],
);

export const engagements = sqliteTable(
  "engagements",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => clientOrgs.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status", { enum: ENGAGEMENT_STATUSES }).notNull().default("planning"),
    summary: text("summary"),
    startDate: text("start_date"),
    targetDate: text("target_date"),
    publicProjectId: text("public_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("engagements_org_idx").on(t.orgId, t.status),
    check("engagements_status_ck", inList(t.status, ENGAGEMENT_STATUSES)),
    check(
      "engagements_start_ck",
      sql`${t.startDate} is null or ${t.startDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "engagements_target_ck",
      sql`${t.targetDate} is null or ${t.targetDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const engagementStaff = sqliteTable(
  "engagement_staff",
  {
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.engagementId, t.userId] }),
    index("engagement_staff_user_idx").on(t.userId),
  ],
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: text("due_date"),
    status: text("status", { enum: ["upcoming", "in_progress", "done", "blocked"] })
      .notNull()
      .default("upcoming"),
    sortOrder: integer("sort_order").notNull().default(0),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("milestones_engagement_idx").on(t.engagementId, t.sortOrder),
    check("milestones_status_ck", inList(t.status, ["upcoming", "in_progress", "done", "blocked"])),
  ],
);

export const deliverables = sqliteTable(
  "deliverables",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: ["pending", "in_review", "approved", "changes_requested"] })
      .notNull()
      .default("pending"),
    dueDate: text("due_date"),
    mediaId: text("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    approvedAt: integer("approved_at"),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("deliverables_engagement_idx").on(t.engagementId),
    check(
      "deliverables_status_ck",
      inList(t.status, ["pending", "in_review", "approved", "changes_requested"]),
    ),
  ],
);

export const engagementFiles = sqliteTable(
  "engagement_files",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    visibility: text("visibility", { enum: ["client", "internal"] })
      .notNull()
      .default("internal"),
    label: text("label").notNull(),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("engagement_files_engagement_idx").on(t.engagementId, t.visibility),
    check("engagement_files_visibility_ck", inList(t.visibility, ["client", "internal"])),
  ],
);

export const engagementMessages = sqliteTable(
  "engagement_messages",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    visibility: text("visibility", { enum: ["client", "internal"] })
      .notNull()
      .default("client"),
    createdAt: integer("created_at").notNull(),
    editedAt: integer("edited_at"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("engagement_messages_engagement_idx").on(t.engagementId, t.createdAt),
    check("engagement_messages_visibility_ck", inList(t.visibility, ["client", "internal"])),
    check("engagement_messages_len_ck", sql`length(${t.body}) between 1 and 10000`),
  ],
);

export const memberProfiles = sqliteTable(
  "member_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    avatarMediaId: text("avatar_media_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    preferences: text("preferences", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [check("member_profiles_prefs_ck", isJson(t.preferences))],
);
