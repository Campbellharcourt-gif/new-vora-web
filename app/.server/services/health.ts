import { and, desc, eq, gt, sql } from "drizzle-orm";
import { aiHealth } from "../ai/service";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { HOUR, MINUTE } from "../lib/time";
import { describeError } from "../observability/logger";

export type ComponentState = "operational" | "degraded" | "down" | "not_configured";

export interface ComponentHealth {
  name: "database" | "email" | "ai" | "storage" | "jobs" | "configuration";
  state: ComponentState;
  latencyMs?: number;
  /** Internal detail — only returned to users with `system.status`. */
  detail?: string;
}

export interface SystemHealth {
  overall: "operational" | "degraded" | "down";
  checkedAt: string;
  components: ComponentHealth[];
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

export async function checkDatabase(ctx: ServerContext): Promise<ComponentHealth> {
  try {
    const { ms } = await timed(() => ctx.env.DB.prepare("select 1 as ok").first());
    const migrations = await ctx.env.DB.prepare("select count(*) as n from d1_migrations")
      .first<{ n: number }>()
      .catch(() => null);
    return {
      name: "database",
      state: ms > 1500 ? "degraded" : "operational",
      latencyMs: ms,
      detail: migrations ? `${migrations.n} migrations applied` : "migrations table not found",
    };
  } catch (error) {
    ctx.log.error("health_database_failed", describeError(error));
    return { name: "database", state: "down", detail: "query failed" };
  }
}

export interface LiveHealth {
  ok: boolean;
  database: "ok" | "down";
  migrations: "complete" | "incomplete" | "unknown";
  foreignKeys: "on" | "off" | "unknown";
}

/**
 * Railway's deploy health check (`/api/health/live`, migration §4.8): only the process, the
 * database and that every shipped migration is applied — never R2, email or AI, so a provider
 * blip cannot block a deploy. It also refuses to report healthy if foreign-key enforcement is off.
 * Returns states only; nothing internal.
 */
export async function checkLive(ctx: ServerContext): Promise<LiveHealth> {
  const out: LiveHealth = {
    ok: false,
    database: "down",
    migrations: "unknown",
    foreignKeys: "unknown",
  };
  try {
    await ctx.env.DB.prepare("select 1 as ok").first();
    out.database = "ok";
    const fk = await ctx.env.DB.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>();
    out.foreignKeys = Number(fk?.foreign_keys) === 1 ? "on" : "off";
    const expected = ctx.env.MIGRATIONS ?? [];
    const rows = await ctx.env.DB.prepare("select name from d1_migrations").all<{ name: string }>();
    const applied = new Set(rows.results.map((r) => r.name));
    out.migrations =
      expected.length > 0 && expected.every((name) => applied.has(name))
        ? "complete"
        : "incomplete";
  } catch (error) {
    ctx.log.error("health_live_failed", describeError(error));
  }
  out.ok = out.database === "ok" && out.migrations === "complete" && out.foreignKeys === "on";
  return out;
}

export async function checkStorage(ctx: ServerContext): Promise<ComponentHealth> {
  try {
    const { ms } = await timed(async () => {
      await ctx.env.MEDIA.head("__health");
      await ctx.env.PRIVATE.head("__health");
    });
    return { name: "storage", state: "operational", latencyMs: ms };
  } catch (error) {
    ctx.log.error("health_storage_failed", describeError(error));
    return { name: "storage", state: "down", detail: "bucket unreachable" };
  }
}

/** Email health from real delivery outcomes (no test sends): recent failures vs successes. */
export async function checkEmail(ctx: ServerContext): Promise<ComponentHealth> {
  const transport = ctx.config.email.transport;
  if (transport === "disabled")
    return { name: "email", state: "not_configured", detail: "transport disabled" };
  try {
    const since = ctx.clock.now() - HOUR;
    const rows = await ctx.db
      .select({ status: schema.emailOutbox.status, n: sql<number>`count(*)` })
      .from(schema.emailOutbox)
      .where(gt(schema.emailOutbox.updatedAt, since))
      .groupBy(schema.emailOutbox.status)
      .all();
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const bad = (by.dead ?? 0) + (by.failed ?? 0);
    const good = by.sent ?? 0;
    const state: ComponentState =
      bad === 0 ? "operational" : good === 0 && bad >= 3 ? "down" : "degraded";
    return { name: "email", state, detail: `${transport}: last hour sent=${good} failed=${bad}` };
  } catch (error) {
    ctx.log.error("health_email_failed", describeError(error));
    return { name: "email", state: "degraded", detail: "outbox unreadable" };
  }
}

export async function checkAi(ctx: ServerContext): Promise<ComponentHealth> {
  try {
    const health = await aiHealth(ctx);
    if (!health.configured)
      return { name: "ai", state: "not_configured", detail: "no provider key" };
    return {
      name: "ai",
      state: health.ok ? "operational" : "degraded",
      latencyMs: health.latencyMs,
      detail: health.ok ? health.model : `${health.model}: ${health.detail ?? "unavailable"}`,
    };
  } catch (error) {
    ctx.log.error("health_ai_failed", describeError(error));
    return { name: "ai", state: "degraded", detail: "health check failed" };
  }
}

export const JOB_EXPECTATIONS = { "email-retry": 15 * MINUTE, daily: 26 * HOUR } as const;

export async function checkJobs(ctx: ServerContext): Promise<ComponentHealth> {
  try {
    const late: string[] = [];
    for (const [job, maxAge] of Object.entries(JOB_EXPECTATIONS)) {
      const last = await ctx.db
        .select({ startedAt: schema.jobRuns.startedAt })
        .from(schema.jobRuns)
        .where(and(eq(schema.jobRuns.job, job), eq(schema.jobRuns.status, "ok")))
        .orderBy(desc(schema.jobRuns.startedAt))
        .get();
      if (!last || ctx.clock.now() - last.startedAt > maxAge) late.push(job);
    }
    return {
      name: "jobs",
      state: late.length === 0 ? "operational" : "degraded",
      detail: late.length ? `no recent successful run: ${late.join(", ")}` : "on schedule",
    };
  } catch (error) {
    ctx.log.error("health_jobs_failed", describeError(error));
    return { name: "jobs", state: "degraded", detail: "job history unreadable" };
  }
}

export function checkConfiguration(ctx: ServerContext): ComponentHealth {
  const missing: string[] = [];
  if (!ctx.config.turnstile.secretKey) missing.push("TURNSTILE_SECRET_KEY");
  if (!ctx.config.ai.geminiApiKey) missing.push("GEMINI_API_KEY");
  if (ctx.config.email.transport === "resend" && !ctx.config.email.resendWebhookSecret)
    missing.push("RESEND_WEBHOOK_SECRET");
  return {
    name: "configuration",
    state: missing.length === 0 ? "operational" : "degraded",
    detail: missing.length ? `optional secrets not set: ${missing.join(", ")}` : "complete",
  };
}

export async function systemHealth(ctx: ServerContext): Promise<SystemHealth> {
  const components = await Promise.all([
    checkDatabase(ctx),
    checkStorage(ctx),
    checkEmail(ctx),
    checkAi(ctx),
    checkJobs(ctx),
  ]);
  components.push(checkConfiguration(ctx));
  const critical = components.filter((c) => c.name === "database" || c.name === "storage");
  const overall = critical.some((c) => c.state === "down")
    ? "down"
    : components.some((c) => c.state === "down" || c.state === "degraded")
      ? "degraded"
      : "operational";
  return { overall, checkedAt: new Date(ctx.clock.now()).toISOString(), components };
}

/** Public view: component states only, no latencies or internal detail. */
export function publicHealth(health: SystemHealth) {
  const visible = new Set(["database", "email", "ai", "storage"]);
  const label: Record<string, string> = {
    database: "Website & portals",
    email: "Email notifications",
    ai: "VORA AI",
    storage: "Media & files",
  };
  return {
    overall: health.overall,
    checkedAt: health.checkedAt,
    components: health.components
      .filter((c) => visible.has(c.name))
      .map((c) => ({ name: label[c.name] ?? c.name, state: c.state })),
  };
}
