import { baseSeedStatements, lit } from "../app/.server/db/seed/sql";
import { newId } from "../app/.server/lib/ids";
import type { SqlDatabase } from "../app/.server/platform/types";

/**
 * Operator actions on a VORA database, shared by the local scripts (`scripts/*.ts`, run with tsx)
 * and the command line inside the production image (`node build/server/index.js <command>`).
 * They issue the same SQL the Wrangler-based scripts issued on Workers.
 */

/** Base seed: roles and permissions from code (upserted), DRAFT content only if missing. */
export async function applyBaseSeed(db: SqlDatabase, now = Date.now()): Promise<number> {
  const statements = baseSeedStatements(now);
  // Batches are atomic; chunk to keep each one small (as the D1 seed did).
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50).map((sql) => db.prepare(sql)));
  }
  return statements.length;
}

/**
 * Maintenance mode from the command line: the `maintenance` setting plus an audit row and a
 * security event, written in one atomic batch — exactly what the admin toggle records.
 */
export async function setMaintenance(
  db: SqlDatabase,
  input: { on: boolean; message: string | null },
  now = Date.now(),
): Promise<void> {
  const value = { enabled: input.on, message: input.on ? input.message : null };
  const json = (v: unknown) => lit(JSON.stringify(v));
  await db.batch(
    [
      `INSERT INTO site_settings (key, value, updated_at) VALUES ('maintenance', ${json(value)}, ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = NULL, updated_at = excluded.updated_at;`,
      `INSERT INTO audit_logs (id, action, target_type, target_id, summary, changes, created_at) VALUES (${lit(newId("audit", now))}, 'settings.update', 'setting', 'maintenance', ${lit(`Maintenance ${input.on ? "enabled" : "disabled"} from the command line`)}, ${json({ to: value, via: "cli" })}, ${now});`,
      `INSERT INTO security_events (id, type, severity, details, created_at) VALUES (${lit(newId("securityEvent", now))}, 'maintenance.changed', 'medium', ${json({ enabled: input.on, via: "cli" })}, ${now});`,
    ].map((sql) => db.prepare(sql)),
  );
}
