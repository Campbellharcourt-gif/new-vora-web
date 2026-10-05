import { SYSTEM_ROLE_KEYS } from "@shared/permissions";
import { z } from "zod";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import { APP_ENVS } from "../config/env";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { writeAudit } from "../observability/audit";

/** Known feature flags and their defaults. Unknown keys are always off. */
export const FLAGS = {
  "accounts.self_signup": {
    default: true,
    description:
      "Allow public Client and Member registration (Owner, Admin and Staff are invite-only)",
  },
  "ai.public_assistant": { default: false, description: "Show the public Ask VORA assistant" },
  "ai.admin_tools": { default: false, description: "Enable VORA AI tools in admin" },
  "auth.breach_check": {
    default: true,
    description: "Reject passwords found in known breaches (k-anonymity check)",
  },
} as const;

export type FlagKey = keyof typeof FLAGS;

interface FlagRow {
  key: string;
  enabled: boolean;
  rules: { roles?: string[]; environments?: string[] } | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { rows: Map<string, FlagRow>; expires: number } | null = null;

export function clearFlagCache(): void {
  cache = null;
}

async function loadFlags(ctx: ServerContext): Promise<Map<string, FlagRow>> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.rows;
  const rows = await ctx.db
    .select({
      key: schema.featureFlags.key,
      enabled: schema.featureFlags.enabled,
      rules: schema.featureFlags.rules,
    })
    .from(schema.featureFlags)
    .all();
  const map = new Map(rows.map((r) => [r.key, r]));
  cache = { rows: map, expires: now + CACHE_TTL_MS };
  return map;
}

/**
 * Evaluates a flag: stored rows override code defaults; optional rules narrow a flag to specific
 * environments or roles. Evaluation errors fail to the code default and are logged.
 */
export async function isFlagEnabled(
  ctx: ServerContext,
  key: FlagKey,
  actor?: Actor | null,
): Promise<boolean> {
  try {
    const row = (await loadFlags(ctx)).get(key);
    if (!row) return FLAGS[key].default;
    if (!row.enabled) return false;
    const rules = row.rules ?? {};
    if (rules.environments?.length && !rules.environments.includes(ctx.config.appEnv)) return false;
    if (rules.roles?.length && !actor?.roles.some((r) => rules.roles?.includes(r))) return false;
    return true;
  } catch (error) {
    ctx.log.error("flag_evaluation_failed", { key, error: String(error) });
    return FLAGS[key].default;
  }
}

const rulesSchema = z
  .object({
    roles: z.array(z.enum(SYSTEM_ROLE_KEYS)).min(1).max(10).optional(),
    environments: z.array(z.enum(APP_ENVS)).min(1).max(4).optional(),
  })
  .strict()
  .nullable();

export function isFlagKey(value: string): value is FlagKey {
  return Object.hasOwn(FLAGS, value);
}

/** Turns a flag on/off (optionally narrowed to roles/environments). Requires `flags.manage`. */
export async function setFeatureFlag(
  ctx: ServerContext,
  actorInput: Actor | null,
  key: string,
  input: { enabled: boolean; rules?: unknown },
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "flags.manage");
  if (!isFlagKey(key)) throw errors.validation({ key: "Unknown feature flag." });
  const rules = rulesSchema.safeParse(input.rules ?? null);
  if (!rules.success)
    throw errors.validation({ rules: "Rules can only name known roles and environments." });
  const before = (await loadFlags(ctx)).get(key) ?? null;
  const now = ctx.clock.now();
  await ctx.db
    .insert(schema.featureFlags)
    .values({
      key,
      description: FLAGS[key].description,
      enabled: input.enabled,
      rules: rules.data,
      updatedBy: actor.userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.featureFlags.key,
      set: { enabled: input.enabled, rules: rules.data, updatedBy: actor.userId, updatedAt: now },
    });
  clearFlagCache();
  await writeAudit(ctx, actor, {
    action: "flag.update",
    targetType: "feature_flag",
    targetId: key,
    summary: `${input.enabled ? "Enabled" : "Disabled"} ${key}`,
    changes: {
      from: before ? { enabled: before.enabled, rules: before.rules } : null,
      to: { enabled: input.enabled, rules: rules.data },
    },
  });
}
