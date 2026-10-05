import { type ContentBlock, missingAltText } from "@shared/content/blocks";
import { CONTENT_KINDS, CONTENT_LABELS, type ContentKind } from "@shared/content/kinds";
import { blocksToText, TextFormatError, textToBlocks } from "@shared/content/text-format";
import { SERVICE_DELIVERY_MODELS } from "@shared/enums";
import type { Permission } from "@shared/permissions";
import { fieldErrors, normaliseUrlInput, optionalText, text } from "@shared/validation/common";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { type IdKind, isId, newId } from "../lib/ids";
import { diff, writeAudit } from "../observability/audit";

/**
 * The CMS (admin side). Every content row is an editable WORKING COPY; the public site only ever
 * reads the immutable snapshot a publish writes to `content_versions` (published-content.ts).
 *
 *   save    → working copy updated, a "draft" version recorded (last 20 kept), marked unpublished
 *   publish → snapshot written as a "published" version (never deleted — DB trigger), row points at it
 *   restore → an earlier version's fields copied back into the working copy as a new draft
 *
 * Permissions are checked here for every operation, per content type.
 */

export { CONTENT_KINDS, CONTENT_LABELS, type ContentKind };

interface Perms {
  view: Permission;
  create: Permission | null;
  edit: Permission;
  publish: Permission;
}

const PERMS: Record<ContentKind, Perms> = {
  project: {
    view: "projects.view",
    create: "projects.create",
    edit: "projects.edit",
    publish: "projects.publish",
  },
  service: {
    view: "services.view",
    create: "services.edit",
    edit: "services.edit",
    publish: "services.publish",
  },
  // Pages are a fixed set (the routes depend on their keys): edited and published, never created.
  page: { view: "pages.view", create: null, edit: "pages.edit", publish: "pages.publish" },
  partner: {
    view: "partners.view",
    create: "partners.edit",
    edit: "partners.edit",
    publish: "partners.publish",
  },
  job_role: {
    view: "careers.view",
    create: "careers.edit",
    edit: "careers.edit",
    publish: "careers.publish",
  },
};

const ID_KIND: Record<ContentKind, IdKind> = {
  project: "project",
  service: "service",
  page: "page",
  partner: "partner",
  job_role: "jobRole",
};

export function contentPermissions(kind: ContentKind): Perms {
  return PERMS[kind];
}

// --- Field schemas (form strings in, typed values out) --------------------------------------------

const slug = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{0,79}$/,
        "Use lower-case letters, numbers and hyphens (up to 80).",
      ),
  );
const nullable = (max: number) => optionalText(max).transform((v) => v ?? null);
const url = (httpsOnly: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => normaliseUrlInput(v) ?? null)
    .refine(
      (v) => {
        if (v === null) return true;
        try {
          const u = new URL(v);
          return httpsOnly ? u.protocol === "https:" : /^https?:$/.test(u.protocol);
        } catch {
          return false;
        }
      },
      `Enter a full link starting with ${httpsOnly ? "https://" : "https:// or http://"}`,
    );
const body = z
  .string()
  .max(200_000, "This content is too long.")
  .optional()
  .transform((value, ctx): ContentBlock[] => {
    try {
      return textToBlocks(value ?? "");
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof TextFormatError ? error.message : "This content isn't valid.",
      });
      return z.NEVER;
    }
  });
const sortOrder = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === "" ? 0 : Number(v)))
  .pipe(z.number().int("Use a whole number.").min(0).max(10_000));
const checkbox = z
  .union([z.literal("on"), z.literal(""), z.boolean()])
  .optional()
  .transform((v) => v === "on" || v === true);
const optionalYear = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? Number(v) : null))
  .pipe(z.number().int().min(1990).max(2100).nullable());
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null))
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")
      .nullable(),
  );

const INPUT = {
  project: z.object({
    slug,
    title: text(1, 160),
    category: nullable(120),
    summary: nullable(500),
    year: optionalYear,
    clientName: nullable(160),
    externalUrl: url(false),
    body,
    seoTitle: nullable(160),
    seoDescription: nullable(320),
    isFeatured: checkbox,
    sortOrder,
  }),
  service: z
    .object({
      slug,
      name: text(1, 120),
      summary: nullable(500),
      deliveryModel: z.enum(SERVICE_DELIVERY_MODELS, { error: "Choose a delivery model." }),
      partnerId: z
        .string()
        .optional()
        .transform((v) => (v?.trim() ? v.trim() : null)),
      body,
      seoTitle: nullable(160),
      seoDescription: nullable(320),
      sortOrder,
    })
    .refine((v) => v.deliveryModel === "vora" || v.partnerId !== null, {
      path: ["partnerId"],
      message: "Choose the partner who delivers this service with VORA.",
    }),
  page: z.object({
    title: text(1, 160),
    intro: nullable(500),
    body,
    seoTitle: nullable(160),
    seoDescription: nullable(320),
  }),
  partner: z.object({
    slug,
    name: text(1, 120),
    relationship: text(1, 160),
    description: nullable(1000),
    statement: nullable(1000),
    url: url(true),
    sortOrder,
  }),
  job_role: z
    .object({
      slug,
      title: text(1, 160),
      department: nullable(120),
      employmentType: z
        .enum(["", "full_time", "part_time", "contract", "freelance", "internship"])
        .optional()
        .transform((v) => (v ? v : null)),
      locationType: z
        .enum(["", "remote", "hybrid", "onsite"])
        .optional()
        .transform((v) => (v ? v : null)),
      locationText: nullable(160),
      summary: nullable(500),
      body,
      applicationMode: z.enum(["form", "email", "external"]).optional().default("email"),
      externalUrl: url(true),
      closesOn: optionalDate,
      sortOrder,
    })
    .refine((v) => v.applicationMode !== "external" || v.externalUrl !== null, {
      path: ["externalUrl"],
      message: "Add the link where people apply.",
    }),
} as const;

type InputOf<K extends ContentKind> = z.infer<(typeof INPUT)[K]>;

/** Converts parsed input to working-copy columns (job roles store the closing date as ms). */
function toColumns(kind: ContentKind, input: Record<string, unknown>): Record<string, unknown> {
  if (kind !== "job_role") return input;
  const { closesOn, ...rest } = input as InputOf<"job_role">;
  return { ...rest, closesAt: closesOn ? Date.parse(`${closesOn}T23:59:59Z`) : null };
}

// --- Tables -----------------------------------------------------------------------------------------

/** The columns every content table shares (used by the generic operations below). */
interface ContentTable {
  id: SQLiteColumn;
  status: SQLiteColumn;
  publishedVersionId: SQLiteColumn;
  publishedAt: SQLiteColumn;
  hasUnpublishedChanges: SQLiteColumn;
  updatedAt: SQLiteColumn;
  archivedAt: SQLiteColumn;
  sortOrder?: SQLiteColumn;
}

const TABLES = {
  project: schema.projects,
  service: schema.services,
  page: schema.pages,
  partner: schema.partners,
  job_role: schema.jobRoles,
} as const;

const NAME_FIELD: Record<ContentKind, "title" | "name"> = {
  project: "title",
  service: "name",
  page: "title",
  partner: "name",
  job_role: "title",
};
const KEY_FIELD: Record<ContentKind, "slug" | "key"> = {
  project: "slug",
  service: "slug",
  page: "key",
  partner: "slug",
  job_role: "slug",
};

function table(kind: ContentKind) {
  return TABLES[kind] as unknown as ContentTable & Record<string, SQLiteColumn>;
}

/** Working-copy fields that are never part of a published snapshot. */
const NOT_IN_SNAPSHOT = new Set([
  "status",
  "publishedVersionId",
  "publishedAt",
  "hasUnpublishedChanges",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "archivedAt",
]);

export function snapshotOf(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !NOT_IN_SNAPSHOT.has(k)));
}

const PUBLISHED_STATUS: Record<ContentKind, string> = {
  project: "published",
  service: "published",
  page: "published",
  partner: "published",
  job_role: "open",
};
const UNPUBLISHED_STATUS: Record<ContentKind, string> = {
  project: "draft",
  service: "draft",
  page: "draft",
  partner: "draft",
  job_role: "closed",
};

const DRAFT_VERSIONS_KEPT = 20;

// --- Reads ----------------------------------------------------------------------------------------

export interface ContentListItem {
  id: string;
  name: string;
  key: string;
  status: string;
  hasUnpublishedChanges: boolean;
  publishedAt: number | null;
  updatedAt: number;
}

export async function listContent(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: ContentKind,
  options: { q?: string; archived?: boolean } = {},
): Promise<ContentListItem[]> {
  await authorize(ctx, actorInput, PERMS[kind].view);
  const t = table(kind);
  const name = t[NAME_FIELD[kind]] as SQLiteColumn;
  const key = t[KEY_FIELD[kind]] as SQLiteColumn;
  const conditions = [options.archived ? sql`${t.archivedAt} is not null` : isNull(t.archivedAt)];
  const q = options.q?.trim().slice(0, 80);
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const match = or(
      sql`${name} like ${pattern} escape '\\'`,
      sql`${key} like ${pattern} escape '\\'`,
    );
    if (match) conditions.push(match);
  }
  const rows = await ctx.db
    .select({
      id: t.id,
      name,
      key,
      status: t.status,
      hasUnpublishedChanges: t.hasUnpublishedChanges,
      publishedAt: t.publishedAt,
      updatedAt: t.updatedAt,
    })
    .from(TABLES[kind] as typeof schema.projects)
    .where(and(...conditions))
    .orderBy(...(t.sortOrder ? [asc(t.sortOrder)] : []), desc(t.updatedAt))
    .all();
  return rows as unknown as ContentListItem[];
}

async function loadRow(ctx: ServerContext, kind: ContentKind, id: string) {
  if (!isId(id, ID_KIND[kind])) throw errors.notFound();
  const t = table(kind);
  const row = (await ctx.db
    .select()
    .from(TABLES[kind] as typeof schema.projects)
    .where(eq(t.id, id))
    .get()) as Record<string, unknown> | undefined;
  if (!row) throw errors.notFound();
  return row;
}

export interface ContentVersionSummary {
  id: string;
  version: number;
  kind: "draft" | "published" | "restored";
  note: string | null;
  createdAt: number;
  createdByName: string | null;
  isLive: boolean;
}

export async function listVersions(
  ctx: ServerContext,
  kind: ContentKind,
  id: string,
  liveVersionId: string | null,
): Promise<ContentVersionSummary[]> {
  const rows = await ctx.db
    .select({
      id: schema.contentVersions.id,
      version: schema.contentVersions.version,
      kind: schema.contentVersions.kind,
      note: schema.contentVersions.note,
      createdAt: schema.contentVersions.createdAt,
      createdByName: schema.users.name,
    })
    .from(schema.contentVersions)
    .leftJoin(schema.users, eq(schema.users.id, schema.contentVersions.createdBy))
    .where(
      and(eq(schema.contentVersions.entityType, kind), eq(schema.contentVersions.entityId, id)),
    )
    .orderBy(desc(schema.contentVersions.version))
    .limit(60)
    .all();
  return rows.map((r) => ({ ...r, isLive: r.id === liveVersionId }));
}

/** One item for the editor: the working copy, its body as editable text, and its history. */
export async function getContent(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: ContentKind,
  id: string,
) {
  const actor = await authorize(ctx, actorInput, PERMS[kind].view);
  const row = await loadRow(ctx, kind, id);
  const versions = await listVersions(ctx, kind, id, (row.publishedVersionId as string) ?? null);
  return {
    row,
    bodyText: Array.isArray(row.body) ? blocksToText(row.body as ContentBlock[]) : "",
    versions,
    can: {
      edit: actor.permissions.has(PERMS[kind].edit),
      publish: actor.permissions.has(PERMS[kind].publish),
    },
  };
}

// --- Writes ---------------------------------------------------------------------------------------

function parseInput<K extends ContentKind>(kind: K, input: Record<string, unknown>): InputOf<K> {
  const parsed = INPUT[kind].safeParse(input);
  if (!parsed.success) {
    throw errors.validation(fieldErrors(parsed.error), "Please check the highlighted fields.");
  }
  return parsed.data as InputOf<K>;
}

/** True when a write failed on a unique index (Drizzle wraps the driver error in `cause`). */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (/UNIQUE constraint failed/.test(String((e as { message?: unknown }).message ?? e))) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

async function assertPartnerExists(ctx: ServerContext, partnerId: string | null) {
  if (!partnerId) return;
  const partner = isId(partnerId, "partner")
    ? await ctx.db
        .select({ id: schema.partners.id })
        .from(schema.partners)
        .where(eq(schema.partners.id, partnerId))
        .get()
    : undefined;
  if (!partner) throw errors.validation({ partnerId: "Choose a partner from the list." });
}

async function nextVersion(ctx: ServerContext, kind: ContentKind, id: string): Promise<number> {
  const row = await ctx.db
    .select({ n: sql<number>`coalesce(max(${schema.contentVersions.version}), 0)` })
    .from(schema.contentVersions)
    .where(
      and(eq(schema.contentVersions.entityType, kind), eq(schema.contentVersions.entityId, id)),
    )
    .get();
  return Number(row?.n ?? 0) + 1;
}

async function recordVersion(
  ctx: ServerContext,
  actor: Actor,
  kind: ContentKind,
  id: string,
  versionKind: "draft" | "published" | "restored",
  snapshot: Record<string, unknown>,
  note: string | null,
): Promise<{ id: string; version: number }> {
  const now = ctx.clock.now();
  const version = await nextVersion(ctx, kind, id);
  const versionId = newId("version", now);
  await ctx.db.insert(schema.contentVersions).values({
    id: versionId,
    entityType: kind,
    entityId: id,
    version,
    kind: versionKind,
    snapshot,
    schemaVersion: 1,
    note: note?.slice(0, 200) ?? null,
    createdBy: actor.userId,
    createdAt: now,
  });
  if (versionKind !== "published") {
    // Keep the most recent drafts; published versions are permanent (and protected by a trigger).
    const old = await ctx.db
      .select({ id: schema.contentVersions.id })
      .from(schema.contentVersions)
      .where(
        and(
          eq(schema.contentVersions.entityType, kind),
          eq(schema.contentVersions.entityId, id),
          ne(schema.contentVersions.kind, "published"),
        ),
      )
      .orderBy(desc(schema.contentVersions.version))
      .limit(100)
      .offset(DRAFT_VERSIONS_KEPT)
      .all();
    if (old.length > 0) {
      await ctx.db.delete(schema.contentVersions).where(
        inArray(
          schema.contentVersions.id,
          old.map((o) => o.id),
        ),
      );
    }
  }
  return { id: versionId, version };
}

export async function createContent<K extends ContentKind>(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: K,
  input: Record<string, unknown>,
): Promise<string> {
  const permission = PERMS[kind].create;
  if (!permission) throw errors.forbidden({ reason: "pages_are_fixed" });
  const actor = await authorize(ctx, actorInput, permission);
  const values = toColumns(kind, parseInput(kind, input) as Record<string, unknown>);
  if (kind === "service") await assertPartnerExists(ctx, values.partnerId as string | null);
  const now = ctx.clock.now();
  const id = newId(ID_KIND[kind], now);
  const extra = kind === "project" ? { credits: [] } : {};
  const bodyDefault = "body" in values ? {} : kind === "partner" ? {} : { body: [] };
  try {
    await ctx.db.insert(TABLES[kind] as never).values({
      id,
      ...bodyDefault,
      ...extra,
      ...values,
      status: "draft",
      hasUnpublishedChanges: true,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    } as never);
  } catch (error) {
    if (isUniqueViolation(error))
      throw errors.validation({ slug: "That address is already used." });
    throw error;
  }
  const row = await loadRow(ctx, kind, id);
  await recordVersion(ctx, actor, kind, id, "draft", snapshotOf(row), "Created");
  const name = String(values[NAME_FIELD[kind]] ?? "");
  await writeAudit(ctx, actor, {
    action: `content.${kind}.create`,
    targetType: kind,
    targetId: id,
    summary: `Created ${CONTENT_LABELS[kind].one.toLowerCase()} “${name}”`,
  });
  return id;
}

export async function saveContent(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: ContentKind,
  id: string,
  input: Record<string, unknown>,
): Promise<void> {
  const actor = await authorize(ctx, actorInput, PERMS[kind].edit);
  const current = await loadRow(ctx, kind, id);
  if (current.archivedAt) throw errors.conflict("Restore this item from the archive to edit it.");
  const values = toColumns(kind, parseInput(kind, input) as Record<string, unknown>);
  if (kind === "service") await assertPartnerExists(ctx, values.partnerId as string | null);
  const now = ctx.clock.now();
  const t = table(kind);
  try {
    await ctx.db
      .update(TABLES[kind] as never)
      .set({
        ...values,
        hasUnpublishedChanges: true,
        updatedBy: actor.userId,
        updatedAt: now,
      } as never)
      .where(eq(t.id, id));
  } catch (error) {
    if (isUniqueViolation(error))
      throw errors.validation({ slug: "That address is already used." });
    throw error;
  }
  const row = await loadRow(ctx, kind, id);
  await recordVersion(ctx, actor, kind, id, "draft", snapshotOf(row), null);
  const fields = Object.keys(values).filter((k) => k !== "body");
  const changes = diff(current, values, fields);
  if (JSON.stringify(current.body) !== JSON.stringify(values.body) && "body" in values) {
    (changes as Record<string, unknown>).body = "edited";
  }
  await writeAudit(ctx, actor, {
    action: `content.${kind}.update`,
    targetType: kind,
    targetId: id,
    summary: `Saved draft of “${String(row[NAME_FIELD[kind]] ?? "")}”`,
    changes,
  });
}

export async function publishContent(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: ContentKind,
  id: string,
  note?: string,
): Promise<{ version: number }> {
  const actor = await authorize(ctx, actorInput, PERMS[kind].publish);
  const row = await loadRow(ctx, kind, id);
  if (row.archivedAt) throw errors.conflict("Restore this item from the archive to publish it.");
  // Re-validate the working copy as a whole: a publish never ships something the editor rejects.
  if (Array.isArray(row.body) && missingAltText(row.body as ContentBlock[]) > 0) {
    throw errors.validation(
      { body: "Every image needs alt text before publishing." },
      "Add alt text to every image before publishing.",
    );
  }
  if (kind === "service" && row.deliveryModel !== "vora" && row.partnerId) {
    const partner = await ctx.db
      .select({ status: schema.partners.status })
      .from(schema.partners)
      .where(eq(schema.partners.id, row.partnerId as string))
      .get();
    if (partner?.status !== "published") {
      throw errors.conflict("Publish the partner first, so the service page can name them.");
    }
  }
  const { id: versionId, version } = await recordVersion(
    ctx,
    actor,
    kind,
    id,
    "published",
    snapshotOf(row),
    note?.trim() || null,
  );
  const now = ctx.clock.now();
  const t = table(kind);
  await ctx.db
    .update(TABLES[kind] as never)
    .set({
      status: PUBLISHED_STATUS[kind],
      publishedVersionId: versionId,
      publishedAt: now,
      hasUnpublishedChanges: false,
      updatedBy: actor.userId,
      updatedAt: now,
    } as never)
    .where(eq(t.id, id));
  await writeAudit(ctx, actor, {
    action: `content.${kind}.publish`,
    targetType: kind,
    targetId: id,
    summary: `Published “${String(row[NAME_FIELD[kind]] ?? "")}” (version ${version})`,
    changes: { version },
  });
  return { version };
}

/** Takes an item off the public site (its published versions stay in the history). */
export async function unpublishContent(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: ContentKind,
  id: string,
): Promise<void> {
  const actor = await authorize(ctx, actorInput, PERMS[kind].publish);
  const row = await loadRow(ctx, kind, id);
  if (row.status !== PUBLISHED_STATUS[kind]) throw errors.conflict("This item isn't live.");
  const now = ctx.clock.now();
  await ctx.db
    .update(TABLES[kind] as never)
    .set({
      status: UNPUBLISHED_STATUS[kind],
      hasUnpublishedChanges: true,
      updatedBy: actor.userId,
      updatedAt: now,
    } as never)
    .where(eq(table(kind).id, id));
  await writeAudit(ctx, actor, {
    action: `content.${kind}.unpublish`,
    targetType: kind,
    targetId: id,
    summary: `Unpublished “${String(row[NAME_FIELD[kind]] ?? "")}”`,
  });
}

export async function setArchived(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: ContentKind,
  id: string,
  archived: boolean,
): Promise<void> {
  if (kind === "page") throw errors.conflict("Pages can't be archived; unpublish instead.");
  const actor = await authorize(ctx, actorInput, PERMS[kind].publish);
  const row = await loadRow(ctx, kind, id);
  const now = ctx.clock.now();
  await ctx.db
    .update(TABLES[kind] as never)
    .set(
      (archived
        ? { status: "archived", archivedAt: now, updatedBy: actor.userId, updatedAt: now }
        : {
            status: "draft",
            archivedAt: null,
            hasUnpublishedChanges: true,
            updatedBy: actor.userId,
            updatedAt: now,
          }) as never,
    )
    .where(eq(table(kind).id, id));
  await writeAudit(ctx, actor, {
    action: `content.${kind}.${archived ? "archive" : "unarchive"}`,
    targetType: kind,
    targetId: id,
    summary: `${archived ? "Archived" : "Restored from archive"} “${String(row[NAME_FIELD[kind]] ?? "")}”`,
  });
}

/** Fields a restore may copy back (the editable fields plus media references). */
const RESTORABLE: Record<ContentKind, string[]> = {
  project: [
    "slug",
    "title",
    "category",
    "summary",
    "body",
    "year",
    "clientName",
    "credits",
    "externalUrl",
    "coverMediaId",
    "seoTitle",
    "seoDescription",
    "ogMediaId",
    "isFeatured",
    "sortOrder",
  ],
  service: [
    "slug",
    "name",
    "summary",
    "body",
    "deliveryModel",
    "partnerId",
    "seoTitle",
    "seoDescription",
    "sortOrder",
  ],
  page: ["title", "intro", "body", "seoTitle", "seoDescription"],
  partner: [
    "slug",
    "name",
    "relationship",
    "description",
    "statement",
    "url",
    "logoMediaId",
    "sortOrder",
  ],
  job_role: [
    "slug",
    "title",
    "department",
    "employmentType",
    "locationType",
    "locationText",
    "summary",
    "body",
    "applicationMode",
    "externalUrl",
    "opensAt",
    "closesAt",
    "sortOrder",
  ],
};

/**
 * Reverts the working copy to an earlier version. The result is a draft (recorded as a
 * "restored" version); it goes live only when someone with publish permission publishes it.
 */
export async function restoreVersion(
  ctx: ServerContext,
  actorInput: Actor | null,
  kind: ContentKind,
  id: string,
  versionId: string,
): Promise<{ version: number }> {
  const actor = await authorize(ctx, actorInput, PERMS[kind].edit);
  const current = await loadRow(ctx, kind, id);
  if (current.archivedAt) throw errors.conflict("Restore this item from the archive first.");
  if (!isId(versionId, "version")) throw errors.notFound();
  const source = await ctx.db
    .select()
    .from(schema.contentVersions)
    .where(
      and(
        eq(schema.contentVersions.id, versionId),
        eq(schema.contentVersions.entityType, kind),
        eq(schema.contentVersions.entityId, id),
      ),
    )
    .get();
  if (!source) throw errors.notFound();
  const values: Record<string, unknown> = {};
  for (const field of RESTORABLE[kind]) {
    if (field in source.snapshot) values[field] = source.snapshot[field];
  }
  const now = ctx.clock.now();
  try {
    await ctx.db
      .update(TABLES[kind] as never)
      .set({
        ...values,
        hasUnpublishedChanges: true,
        updatedBy: actor.userId,
        updatedAt: now,
      } as never)
      .where(eq(table(kind).id, id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict(
        "Another item now uses this version's address. Change that item's address first.",
      );
    }
    throw error;
  }
  const row = await loadRow(ctx, kind, id);
  const { version } = await recordVersion(
    ctx,
    actor,
    kind,
    id,
    "restored",
    snapshotOf(row),
    `Restored from version ${source.version}`,
  );
  await writeAudit(ctx, actor, {
    action: `content.${kind}.restore`,
    targetType: kind,
    targetId: id,
    summary: `Restored “${String(row[NAME_FIELD[kind]] ?? "")}” to version ${source.version}`,
    changes: { fromVersion: source.version, newVersion: version },
  });
  return { version };
}

/** Partners to choose from on the service form. */
export async function partnerOptions(ctx: ServerContext) {
  return ctx.db
    .select({ id: schema.partners.id, name: schema.partners.name })
    .from(schema.partners)
    .where(isNull(schema.partners.archivedAt))
    .orderBy(asc(schema.partners.name))
    .all();
}

/** Counts for the dashboard: items with unpublished changes per content type the actor sees. */
export async function contentSummary(ctx: ServerContext, actor: Actor) {
  const out: { kind: ContentKind; total: number; unpublished: number }[] = [];
  for (const kind of CONTENT_KINDS) {
    if (!actor.permissions.has(PERMS[kind].view)) continue;
    const t = table(kind);
    const row = await ctx.db
      .select({
        total: sql<number>`count(*)`,
        unpublished: sql<number>`sum(case when ${t.hasUnpublishedChanges} then 1 else 0 end)`,
      })
      .from(TABLES[kind] as typeof schema.projects)
      .where(isNull(t.archivedAt))
      .get();
    out.push({ kind, total: Number(row?.total ?? 0), unpublished: Number(row?.unpublished ?? 0) });
  }
  return out;
}
