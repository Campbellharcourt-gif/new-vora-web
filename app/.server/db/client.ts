import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/libsql";
import type { SqlDatabase } from "../platform/types";
import * as schema from "./schema";

function build(database: SqlDatabase) {
  return drizzle(database.client, { schema });
}

const instances = new WeakMap<SqlDatabase, ReturnType<typeof build>>();

/**
 * One Drizzle instance per database, reused across requests. Building one walks the whole schema
 * (relational config), so it is done once. The instance holds only the libSQL client, the schema
 * and the SQL dialect — no request, user or transaction state — so reuse is safe.
 */
export function createDb(database: SqlDatabase) {
  let db = instances.get(database);
  if (!db) {
    db = build(database);
    instances.set(database, db);
  }
  return db;
}

export type Database = ReturnType<typeof build>;
export type Statement = BatchItem<"sqlite">;

/**
 * Runs statements atomically in one batch (all succeed or none are applied). libSQL runs a batch
 * in one transaction and rolls it back if any statement fails — the same guarantee D1's batch
 * gave — so multi-row invariants stay written as one batch.
 */
export async function runBatch(db: Database, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [Statement, ...Statement[]]);
}

/**
 * Rows changed by a `.run()` (UPDATE/DELETE/INSERT). Kept behind one helper so the code stays
 * driver-neutral: libSQL reports `rowsAffected` where D1 reported `meta.changes`.
 */
export function affectedRows(result: { rowsAffected?: number }): number {
  return result.rowsAffected ?? 0;
}

export { schema };
