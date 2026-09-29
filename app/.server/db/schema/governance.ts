import { EMAIL_STATUSES, SECURITY_SEVERITIES } from "@shared/enums";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { inList, isBool, isJson } from "./_helpers";
import { users } from "./identity";

/**
 * Security events and audit logs are append-only (enforced by triggers in migrations) and
 * deliberately have no foreign keys to `users`, so deleting a user never rewrites history.
 */
export const securityEvents = sqliteTable(
  "security_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    severity: text("severity", { enum: SECURITY_SEVERITIES }).notNull(),
    userId: text("user_id"),
    ipHash: text("ip_hash"),
    country: text("country"),
    userAgent: text("user_agent"),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
    requestId: text("request_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("security_events_created_idx").on(t.createdAt),
    index("security_events_user_idx").on(t.userId, t.createdAt),
    index("security_events_severity_idx").on(t.severity, t.createdAt),
    check("security_events_severity_ck", inList(t.severity, SECURITY_SEVERITIES)),
    check("security_events_details_ck", isJson(t.details)),
  ],
);

export const securityEventAcks = sqliteTable("security_event_acks", {
  eventId: text("event_id")
    .primaryKey()
    .references(() => securityEvents.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    actorRoles: text("actor_roles", { mode: "json" }).$type<string[]>(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    summary: text("summary").notNull(),
    changes: text("changes", { mode: "json" }).$type<Record<string, unknown>>(),
    ipHash: text("ip_hash"),
    requestId: text("request_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_logs_target_idx").on(t.targetType, t.targetId, t.createdAt),
    check("audit_logs_changes_ck", isJson(t.changes)),
    check("audit_logs_roles_ck", isJson(t.actorRoles)),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

export const emailOutbox = sqliteTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    template: text("template").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    /** Template data. For sensitive templates this is `{ redacted: true }` — never codes/links. */
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: EMAIL_STATUSES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at"),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (t) => [
    uniqueIndex("email_outbox_idem_uq").on(t.idempotencyKey),
    index("email_outbox_status_idx").on(t.status, t.nextAttemptAt),
    index("email_outbox_related_idx").on(t.relatedType, t.relatedId),
    check("email_outbox_status_ck", inList(t.status, EMAIL_STATUSES)),
    check("email_outbox_payload_ck", isJson(t.payload)),
    check("email_outbox_sensitive_ck", isBool(t.sensitive)),
  ],
);

export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    job: text("job").notNull(),
    status: text("status", { enum: ["running", "ok", "failed"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [
    index("job_runs_job_idx").on(t.job, t.startedAt),
    check("job_runs_status_ck", inList(t.status, ["running", "ok", "failed"])),
    check("job_runs_details_ck", isJson(t.details)),
  ],
);

export const featureFlags = sqliteTable(
  "feature_flags",
  {
    key: text("key").primaryKey(),
    description: text("description").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    rules: text("rules", { mode: "json" }).$type<{ roles?: string[]; environments?: string[] }>(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("feature_flags_enabled_ck", isBool(t.enabled)),
    check("feature_flags_rules_ck", isJson(t.rules)),
  ],
);

export const siteSettings = sqliteTable(
  "site_settings",
  {
    key: text("key").primaryKey(),
    value: text("value", { mode: "json" }).$type<unknown>().notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [check("site_settings_value_ck", isJson(t.value))],
);

export const SOCIAL_PLATFORMS = [
  "x",
  "discord",
  "instagram",
  "linkedin",
  "youtube",
  "tiktok",
  "github",
  "behance",
  "dribbble",
  "vimeo",
  "threads",
  "other",
] as const;

export const socialLinks = sqliteTable(
  "social_links",
  {
    id: text("id").primaryKey(),
    platform: text("platform", { enum: SOCIAL_PLATFORMS }).notNull(),
    label: text("label").notNull(),
    url: text("url").notNull(),
    handle: text("handle"),
    placements: text("placements", { mode: "json" }).$type<string[]>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("social_links_order_idx").on(t.isVisible, t.sortOrder),
    check("social_links_platform_ck", inList(t.platform, SOCIAL_PLATFORMS)),
    check("social_links_url_ck", sql`${t.url} like 'https://%'`),
    check("social_links_visible_ck", isBool(t.isVisible)),
    check("social_links_placements_ck", isJson(t.placements)),
  ],
);

export const privacyRequests = sqliteTable(
  "privacy_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    type: text("type", { enum: ["export", "delete"] }).notNull(),
    status: text("status", {
      enum: ["received", "in_progress", "completed", "rejected"],
    }).notNull(),
    requestedAt: integer("requested_at").notNull(),
    completedAt: integer("completed_at"),
    handledBy: text("handled_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
  },
  (t) => [
    index("privacy_requests_status_idx").on(t.status, t.requestedAt),
    check("privacy_requests_type_ck", inList(t.type, ["export", "delete"])),
    check(
      "privacy_requests_status_ck",
      inList(t.status, ["received", "in_progress", "completed", "rejected"]),
    ),
  ],
);
