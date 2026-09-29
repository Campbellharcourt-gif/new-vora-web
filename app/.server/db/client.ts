import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

function build(d1: D1Database) {
  return drizzle(d1, { schema });
}

const instances = new WeakMap<D1Database, ReturnType<typeof build>>();

/**
 * One Drizzle instance per D1 binding, reused across requests in the same isolate (CP-3 · Free
 * plan). Building one walks the whole schema (relational config); reusing it saved ~0.3–1 ms of
 * CPU per request in local A/B runs — worth having against the Free plan's 10 ms. The instance
 * holds only the binding, the schema and the SQL dialect — no request, user or transaction state
 * — so reuse is safe.
 */
export function createDb(d1: D1Database) {
  let db = instances.get(d1);
  if (!db) {
    db = build(d1);
    instances.set(d1, db);
  }
  return db;
}

export type Database = ReturnType<typeof build>;
export type Statement = BatchItem<"sqlite">;

/**
 * Runs statements atomically in one D1 batch (all succeed or none are applied). D1 has no
 * interactive transactions, so multi-row invariants are written as one batch.
 */
export async function runBatch(db: Database, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [Statement, ...Statement[]]);
}

export { schema };
