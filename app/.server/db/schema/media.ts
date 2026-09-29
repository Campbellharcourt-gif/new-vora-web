import { MEDIA_KINDS } from "@shared/enums";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { inList } from "./_helpers";
import { users } from "./identity";

export const MEDIA_STATUSES = ["uploading", "ready", "failed", "quarantined"] as const;

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    bucket: text("bucket", { enum: ["media", "private"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    kind: text("kind", { enum: MEDIA_KINDS }).notNull(),
    mimeType: text("mime_type").notNull(),
    originalName: text("original_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    checksumSha256: text("checksum_sha256"),
    altText: text("alt_text"),
    caption: text("caption"),
    credit: text("credit"),
    focalX: real("focal_x"),
    focalY: real("focal_y"),
    placeholder: text("placeholder"),
    status: text("status", { enum: MEDIA_STATUSES }).notNull(),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("media_assets_key_uq").on(t.storageKey),
    index("media_assets_kind_idx").on(t.kind, t.createdAt),
    index("media_assets_deleted_idx").on(t.deletedAt),
    check("media_assets_bucket_ck", inList(t.bucket, ["media", "private"])),
    check("media_assets_kind_ck", inList(t.kind, MEDIA_KINDS)),
    check("media_assets_status_ck", inList(t.status, MEDIA_STATUSES)),
    check("media_assets_size_ck", sql`${t.sizeBytes} >= 0`),
    check(
      "media_assets_focal_ck",
      sql`(${t.focalX} is null or ${t.focalX} between 0 and 1) and (${t.focalY} is null or ${t.focalY} between 0 and 1)`,
    ),
  ],
);

export const mediaRevisions = sqliteTable(
  "media_revisions",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256"),
    replacedBy: text("replaced_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    purgeAfter: integer("purge_after").notNull(),
  },
  (t) => [
    index("media_revisions_media_idx").on(t.mediaId),
    index("media_revisions_purge_idx").on(t.purgeAfter),
  ],
);

export const mediaUsages = sqliteTable(
  "media_usages",
  {
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.mediaId, t.entityType, t.entityId, t.field] }),
    index("media_usages_entity_idx").on(t.entityType, t.entityId),
  ],
);
