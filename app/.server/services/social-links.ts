import { fieldErrors, normaliseUrlInput } from "@shared/validation/common";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { SOCIAL_PLATFORMS } from "../db/schema/governance";
import { errors } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { diff, writeAudit } from "../observability/audit";

/** Social links shown in the site footer (Content › Social links). https only. */

export const SOCIAL_PLACEMENTS = ["footer", "contact"] as const;

const linkInput = z.object({
  platform: z.enum(SOCIAL_PLATFORMS, { error: "Choose a platform." }),
  label: z.string().trim().min(1, "Add a label.").max(60),
  url: z
    .string()
    .transform((v) => normaliseUrlInput(v) ?? "")
    .pipe(
      z
        .string()
        .max(500)
        .refine((v) => {
          try {
            return new URL(v).protocol === "https:";
          } catch {
            return false;
          }
        }, "Enter a full link starting with https://"),
    ),
  handle: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  isVisible: z
    .union([z.literal("on"), z.literal(""), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === true),
  sortOrder: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? 0 : Number(v)))
    .pipe(z.number().int().min(0).max(1000)),
});

export async function listSocialLinks(ctx: ServerContext, actorInput: Actor | null) {
  await authorize(ctx, actorInput, "social.manage");
  return ctx.db
    .select()
    .from(schema.socialLinks)
    .orderBy(asc(schema.socialLinks.sortOrder), asc(schema.socialLinks.createdAt))
    .all();
}

function parse(input: Record<string, unknown>) {
  const parsed = linkInput.safeParse(input);
  if (!parsed.success) {
    throw errors.validation(fieldErrors(parsed.error), "Please check the highlighted fields.");
  }
  return parsed.data;
}

export async function saveSocialLink(
  ctx: ServerContext,
  actorInput: Actor | null,
  id: string | null,
  input: Record<string, unknown>,
): Promise<string> {
  const actor = await authorize(ctx, actorInput, "social.manage");
  const v = parse(input);
  const now = ctx.clock.now();
  if (!id) {
    const newLinkId = newId("social", now);
    await ctx.db.insert(schema.socialLinks).values({
      id: newLinkId,
      ...v,
      placements: ["footer"],
      updatedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, actor, {
      action: "social.create",
      targetType: "social_link",
      targetId: newLinkId,
      summary: `Added social link ${v.label}`,
    });
    return newLinkId;
  }
  if (!isId(id, "social")) throw errors.notFound();
  const current = await ctx.db
    .select()
    .from(schema.socialLinks)
    .where(eq(schema.socialLinks.id, id))
    .get();
  if (!current) throw errors.notFound();
  await ctx.db
    .update(schema.socialLinks)
    .set({ ...v, updatedBy: actor.userId, updatedAt: now })
    .where(eq(schema.socialLinks.id, id));
  await writeAudit(ctx, actor, {
    action: "social.update",
    targetType: "social_link",
    targetId: id,
    summary: `Updated social link ${v.label}`,
    changes: diff(current, v, ["platform", "label", "url", "handle", "isVisible", "sortOrder"]),
  });
  return id;
}

export async function deleteSocialLink(
  ctx: ServerContext,
  actorInput: Actor | null,
  id: string,
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "social.manage");
  if (!isId(id, "social")) throw errors.notFound();
  const removed = await ctx.db
    .delete(schema.socialLinks)
    .where(eq(schema.socialLinks.id, id))
    .returning({ label: schema.socialLinks.label, url: schema.socialLinks.url });
  if (removed.length === 0) throw errors.notFound();
  await writeAudit(ctx, actor, {
    action: "social.delete",
    targetType: "social_link",
    targetId: id,
    summary: `Removed social link ${removed[0]?.label ?? ""}`,
    changes: { url: removed[0]?.url },
  });
}
