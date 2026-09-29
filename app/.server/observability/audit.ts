import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { hmacHex } from "../lib/crypto";
import { newId } from "../lib/ids";

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  /** Diff of non-sensitive fields only. Never include passwords, tokens or message bodies. */
  changes?: Record<string, unknown>;
}

/** Hashes the client IP with a purpose-bound key (raw IPs are never stored). */
export async function hashIp(ctx: ServerContext): Promise<string> {
  return hmacHex(ctx.config.authSecrets[0] as string, "ip-hash", ctx.meta.ip);
}

/**
 * Appends an audit record. Audit writes are part of the operation: if the audit insert fails,
 * the caller sees the error rather than silently losing the trail.
 */
export async function writeAudit(
  ctx: ServerContext,
  actor: Pick<Actor, "userId" | "roles"> | null,
  entry: AuditEntry,
): Promise<void> {
  await ctx.db.insert(schema.auditLogs).values({
    id: newId("audit", ctx.clock.now()),
    actorUserId: actor?.userId ?? null,
    actorRoles: actor?.roles ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    summary: entry.summary.slice(0, 500),
    changes: entry.changes ?? null,
    ipHash: await hashIp(ctx),
    requestId: ctx.requestId,
    createdAt: ctx.clock.now(),
  });
  ctx.log.info("audit", {
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
  });
}

/** Builds a shallow diff between two records for the fields listed. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (JSON.stringify(from) !== JSON.stringify(to)) out[String(field)] = { from, to };
  }
  return out;
}
