import { APPLICATION_STATUSES, ENQUIRY_STATUSES } from "@shared/enums";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { inList, isBool, isJson } from "./_helpers";
import { jobRoles } from "./content";
import { users } from "./identity";
import { mediaAssets } from "./media";

export const enquiries = sqliteTable(
  "enquiries",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull(),
    /** Client-generated per form render; makes double submits idempotent. */
    submissionKey: text("submission_key"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company"),
    websiteUrl: text("website_url"),
    projectTypes: text("project_types", { mode: "json" }).$type<string[]>().notNull(),
    budgetKey: text("budget_key"),
    budgetLabel: text("budget_label"),
    timelineKey: text("timeline_key").notNull(),
    timelineLabel: text("timeline_label").notNull(),
    timelineDate: text("timeline_date"),
    message: text("message").notNull(),
    sourceKey: text("source_key"),
    sourceLabel: text("source_label"),
    sourceDetail: text("source_detail"),
    status: text("status", { enum: ENQUIRY_STATUSES }).notNull().default("received"),
    assignedTo: text("assigned_to").references(() => users.id, { onDelete: "set null" }),
    spamScore: integer("spam_score").notNull().default(0),
    turnstileOk: integer("turnstile_ok", { mode: "boolean" }).notNull().default(false),
    consentAt: integer("consent_at").notNull(),
    ipHash: text("ip_hash"),
    country: text("country"),
    userAgent: text("user_agent"),
    firstResponseAt: integer("first_response_at"),
    closedAt: integer("closed_at"),
    retentionUntil: integer("retention_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("enquiries_reference_uq").on(t.reference),
    uniqueIndex("enquiries_submission_uq").on(t.submissionKey),
    index("enquiries_status_idx").on(t.status, t.createdAt),
    index("enquiries_email_idx").on(t.email, t.createdAt),
    index("enquiries_ip_idx").on(t.ipHash, t.createdAt),
    check("enquiries_status_ck", inList(t.status, ENQUIRY_STATUSES)),
    check("enquiries_types_ck", isJson(t.projectTypes)),
    check("enquiries_spam_ck", sql`${t.spamScore} between 0 and 100`),
    check("enquiries_turnstile_ck", isBool(t.turnstileOk)),
    check("enquiries_message_len_ck", sql`length(${t.message}) between 1 and 5000`),
    check("enquiries_email_lower_ck", sql`${t.email} = lower(${t.email})`),
  ],
);

export const enquiryEvents = sqliteTable(
  "enquiry_events",
  {
    id: text("id").primaryKey(),
    enquiryId: text("enquiry_id")
      .notNull()
      .references(() => enquiries.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["received", "status_change", "note", "assignment", "email"],
    }).notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    body: text("body"),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("enquiry_events_enquiry_idx").on(t.enquiryId, t.createdAt),
    check(
      "enquiry_events_type_ck",
      inList(t.type, ["received", "status_change", "note", "assignment", "email"]),
    ),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    jobRoleId: text("job_role_id").references(() => jobRoles.id, { onDelete: "set null" }),
    submissionKey: text("submission_key"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    portfolioUrl: text("portfolio_url"),
    message: text("message").notNull(),
    cvMediaId: text("cv_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    status: text("status", { enum: APPLICATION_STATUSES }).notNull().default("received"),
    consentAt: integer("consent_at").notNull(),
    ipHash: text("ip_hash"),
    retentionUntil: integer("retention_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("applications_submission_uq").on(t.submissionKey),
    index("applications_role_idx").on(t.jobRoleId, t.status),
    index("applications_created_idx").on(t.createdAt),
    check("applications_status_ck", inList(t.status, APPLICATION_STATUSES)),
    check("applications_email_lower_ck", sql`${t.email} = lower(${t.email})`),
  ],
);

export const applicationEvents = sqliteTable(
  "application_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["received", "status_change", "note", "email"] }).notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    body: text("body"),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("application_events_app_idx").on(t.applicationId, t.createdAt),
    check(
      "application_events_type_ck",
      inList(t.type, ["received", "status_change", "note", "email"]),
    ),
    check("application_events_body_ck", sql`${t.body} is null or length(${t.body}) <= 5000`),
    check(
      "application_events_status_ck",
      sql`${t.toStatus} is null or ${inList(t.toStatus, APPLICATION_STATUSES)}`,
    ),
  ],
);
