import type { Permission } from "@shared/permissions";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";

/**
 * Typed site settings. Each key has a Zod schema and a default; stored values are validated on
 * read and write, so a bad row can never crash a page (it falls back to the default and logs).
 */
const option = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().min(1).max(80),
});

export const SETTINGS = {
  "site.identity": {
    schema: z.object({
      name: z.string().min(1).max(60),
      tagline: z.string().max(160).nullable(),
      partnerLine: z.string().max(120).nullable(),
    }),
    default: { name: "VORA", tagline: null, partnerLine: "Creative by Solara. Digital by VORA." },
  },
  "contact.emails": {
    schema: z.object({
      general: z.email(),
      projects: z.email(),
      support: z.email(),
      careers: z.email(),
    }),
    default: {
      general: "hello@vorawebsites.store",
      projects: "projects@vorawebsites.store",
      support: "support@vorawebsites.store",
      careers: "careers@vorawebsites.store",
    },
  },
  "enquiry.options": {
    schema: z.object({
      /** Empty until VORA provides real ranges; the budget field is hidden while empty. */
      budgets: z.array(option).max(12),
      timelines: z.array(option).min(1).max(12),
      sources: z.array(option).max(12),
    }),
    default: {
      budgets: [],
      timelines: [
        { key: "asap", label: "As soon as possible" },
        { key: "2_4_weeks", label: "Within 2–4 weeks" },
        { key: "1_2_months", label: "1–2 months" },
        { key: "flexible", label: "Flexible" },
        { key: "specific_date", label: "By a specific date" },
      ],
      sources: [
        { key: "search", label: "Search" },
        { key: "social", label: "Social media" },
        { key: "referral", label: "Referral or word of mouth" },
        { key: "solara", label: "Solara Studios" },
        { key: "previous_client", label: "I've worked with VORA before" },
        { key: "other", label: "Other" },
      ],
    },
  },
  /** Home page lines. "*word*" sets one word in italics; a null invitation keeps the copy slot. */
  "home.copy": {
    schema: z.object({
      approachLines: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
      invitationLine: z.string().trim().max(160).nullable(),
    }),
    default: {
      approachLines: ["Great ideas. Average *presence.*", "VORA starts with websites."],
      invitationLine: null,
    },
  },
  /** A one-line site-wide notice above the header. Off by default. */
  "site.announcement": {
    schema: z
      .object({
        enabled: z.boolean(),
        message: z.string().trim().max(200),
        linkLabel: z.string().trim().max(60).nullable(),
        linkHref: z
          .string()
          .trim()
          .max(300)
          .refine(
            (v) =>
              (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) ||
              /^https:\/\/[^\s]+$/.test(v),
            "Links must be a site path like /contact or start with https://",
          )
          .nullable(),
      })
      .refine((v) => !v.enabled || v.message.length > 0, {
        path: ["message"],
        message: "Write the announcement before switching it on.",
      })
      .refine((v) => (v.linkLabel === null) === (v.linkHref === null), {
        path: ["linkHref"],
        message: "Give the link both a label and an address, or neither.",
      }),
    default: { enabled: false, message: "", linkLabel: null, linkHref: null },
  },
  maintenance: {
    schema: z.object({
      enabled: z.boolean(),
      message: z.string().max(400).nullable(),
    }),
    default: { enabled: false, message: null },
  },
  retention: {
    schema: z.object({
      enquiryMonths: z.number().int().min(1).max(120),
      applicationMonths: z.number().int().min(1).max(60),
      loginHistoryDays: z.number().int().min(30).max(730),
      aiAnonymousDays: z.number().int().min(1).max(365),
      emailOutboxDays: z.number().int().min(7).max(365),
    }),
    default: {
      enquiryMonths: 24,
      applicationMonths: 12,
      loginHistoryDays: 180,
      aiAnonymousDays: 30,
      emailOutboxDays: 90,
    },
  },
  "ai.config": {
    schema: z.object({
      provider: z.enum(["gemini"]),
      model: z.string().regex(/^[a-z0-9.-]{3,64}$/),
      thinkingLevel: z.enum(["low", "medium", "high"]),
      maxOutputTokens: z.number().int().min(64).max(8192),
      requestTimeoutMs: z.number().int().min(2000).max(60000),
      publicEnabled: z.boolean(),
      adminEnabled: z.boolean(),
      maxInputChars: z.number().int().min(100).max(8000),
      maxTurns: z.number().int().min(1).max(50),
      dailyRequestLimit: z.number().int().min(0).max(100000),
      dailyTokenLimit: z.number().int().min(0).max(100_000_000),
      /** Estimated USD per 1M tokens, for the cost dashboard only (update from provider pricing). */
      priceInputPerMTokUsd: z.number().min(0).max(1000),
      priceOutputPerMTokUsd: z.number().min(0).max(1000),
    }),
    default: {
      provider: "gemini" as const,
      model: "gemini-3.8-flash",
      thinkingLevel: "low" as const,
      maxOutputTokens: 1024,
      requestTimeoutMs: 20000,
      publicEnabled: false,
      adminEnabled: false,
      maxInputChars: 2000,
      maxTurns: 20,
      dailyRequestLimit: 2000,
      dailyTokenLimit: 4_000_000,
      priceInputPerMTokUsd: 0,
      priceOutputPerMTokUsd: 0,
    },
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; expires: number }>();

export function clearSettingsCache(): void {
  cache.clear();
}

export async function getSetting<K extends SettingKey>(
  ctx: ServerContext,
  key: K,
): Promise<SettingValue<K>> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value as SettingValue<K>;

  const def = SETTINGS[key];
  const row = await ctx.db
    .select({ value: schema.siteSettings.value })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.key, key))
    .get();

  let value: SettingValue<K> = def.default as SettingValue<K>;
  if (row) {
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) value = parsed.data as SettingValue<K>;
    else
      ctx.log.error("setting_invalid_using_default", { key, issues: parsed.error.issues.length });
  }
  cache.set(key, { value, expires: now + CACHE_TTL_MS });
  return value;
}

/** The permission each setting requires to change (checked here, not only in the admin UI). */
export const SETTING_PERMISSIONS: Record<SettingKey, Permission> = {
  "site.identity": "settings.manage",
  "contact.emails": "settings.manage",
  "enquiry.options": "settings.manage",
  "home.copy": "pages.publish",
  "site.announcement": "pages.publish",
  maintenance: "maintenance.manage",
  retention: "settings.manage",
  "ai.config": "ai.manage",
};

export async function setSetting<K extends SettingKey>(
  ctx: ServerContext,
  actorInput: Actor | null,
  key: K,
  value: unknown,
): Promise<SettingValue<K>> {
  const actor = await authorize(ctx, actorInput, SETTING_PERMISSIONS[key]);
  const parsed = SETTINGS[key].schema.safeParse(value);
  if (!parsed.success) {
    throw errors.validation({ [key]: parsed.error.issues[0]?.message ?? "Invalid value" });
  }
  const before = await getSetting(ctx, key);
  const now = ctx.clock.now();
  await ctx.db
    .insert(schema.siteSettings)
    .values({ key, value: parsed.data, updatedBy: actor.userId, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.siteSettings.key,
      set: { value: parsed.data, updatedBy: actor.userId, updatedAt: now },
    });
  cache.delete(key);
  await writeAudit(ctx, actor, {
    action: "settings.update",
    targetType: "setting",
    targetId: key,
    summary: `Updated setting ${key}`,
    changes: { from: before as unknown, to: parsed.data as unknown } as Record<string, unknown>,
  });
  if (key === "maintenance") {
    await recordSecurityEvent(ctx, {
      type: "maintenance.changed",
      severity: "medium",
      userId: actor.userId,
      details: { enabled: (parsed.data as { enabled: boolean }).enabled },
    });
  }
  return parsed.data as SettingValue<K>;
}
