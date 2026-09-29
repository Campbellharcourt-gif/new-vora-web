import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  type Client,
  createClient,
  type InStatement,
  type InValue,
  type ResultSet,
} from "@libsql/client";
import type {
  SqlDatabase,
  SqlResult,
  SqlStatement,
  SqlValue,
} from "../../app/.server/platform/types";

/**
 * SQLite on the service's volume through libSQL (Railway migration R3, §6.4).
 *
 * - **One connection** (`concurrency: 1`). SQLite serialises writes anyway, and one connection
 *   guarantees every statement runs with the PRAGMAs below.
 * - **Foreign keys ON.** D1 enforced foreign keys; plain SQLite does not by default. This build of
 *   libSQL is compiled with `SQLITE_DEFAULT_FOREIGN_KEYS`, so any connection it opens starts with
 *   them on — and the PRAGMA is also set explicitly, and `verifyPragmas` refuses to continue if it
 *   ever reads 0. tests/integration/sqlite-platform.test.ts proves both.
 * - **WAL** for file databases (the client never sets it), `synchronous = NORMAL` (the documented
 *   pairing for WAL), and a busy timeout so contention waits instead of failing at once.
 * - **Batches are atomic**: libSQL runs a batch in one transaction and rolls it back on any error,
 *   the guarantee D1 gave.
 */

export interface OpenOptions {
  /** A filesystem path, or ":memory:" (tests). */
  path: string;
  /** How long a statement waits for a lock before SQLITE_BUSY. */
  busyTimeoutMs?: number;
}

export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

function toArgs(values: unknown[]): SqlValue[] {
  return values.map((value, index) => {
    if (value === undefined) {
      // D1 refused undefined too; binding it as NULL would hide a bug.
      throw new TypeError(`SQL parameter ${index + 1} is undefined`);
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    return value as SqlValue;
  });
}

function rowsOf<T>(result: ResultSet): T[] {
  return result.rows.map((row) => {
    const out: Record<string, unknown> = {};
    result.columns.forEach((column, index) => {
      out[column] = row[index];
    });
    return out as T;
  });
}

function resultOf<T>(result: ResultSet, started: number): SqlResult<T> {
  return {
    results: rowsOf<T>(result),
    success: true,
    meta: {
      changes: result.rowsAffected,
      last_row_id: result.lastInsertRowid === undefined ? 0 : Number(result.lastInsertRowid),
      duration: performance.now() - started,
    },
  };
}

class Statement implements SqlStatement {
  constructor(
    private readonly database: SqliteDatabase,
    readonly sql: string,
    readonly args: readonly SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new Statement(this.database, this.sql, toArgs(values));
  }

  toInStatement(): InStatement {
    return { sql: this.sql, args: this.args as InValue[] };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.database.client.execute(this.toInStatement());
    const row = rowsOf<Record<string, unknown>>(result)[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`Column not found: ${column}`);
    return row[column] as T;
  }

  async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    const started = performance.now();
    return resultOf<T>(await this.database.client.execute(this.toInStatement()), started);
  }

  async run<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return this.all<T>();
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const result = await this.database.client.execute(this.toInStatement());
    return result.rows.map((row) => Array.from(row) as T);
  }
}

export class SqliteDatabase implements SqlDatabase {
  constructor(
    readonly client: Client,
    readonly path: string,
  ) {}

  prepare(sql: string): SqlStatement {
    return new Statement(this, sql);
  }

  async batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    if (statements.length === 0) return [];
    const started = performance.now();
    const results = await this.client.batch(
      statements.map((s) => ({ sql: s.sql, args: s.args as InValue[] })),
      "write",
    );
    return results.map((r) => resultOf<T>(r, started));
  }

  async exec(sql: string): Promise<void> {
    await this.client.executeMultiple(sql);
  }

  close(): void {
    this.client.close();
  }
}

export interface PragmaState {
  foreignKeys: number;
  journalMode: string;
  busyTimeout: number;
  synchronous: number;
}

export async function readPragmas(db: SqlDatabase): Promise<PragmaState> {
  const one = async (sql: string) => {
    const row = (await db.client.execute(sql)).rows[0];
    return row ? row[0] : null;
  };
  return {
    foreignKeys: Number(await one("PRAGMA foreign_keys")),
    journalMode: String(await one("PRAGMA journal_mode")),
    busyTimeout: Number(await one("PRAGMA busy_timeout")),
    synchronous: Number(await one("PRAGMA synchronous")),
  };
}

/** Refuses to continue unless foreign keys are enforced (and WAL is on for a file database). */
export async function verifyPragmas(db: SqliteDatabase): Promise<PragmaState> {
  const state = await readPragmas(db);
  if (state.foreignKeys !== 1) {
    throw new Error("SQLite foreign-key enforcement is OFF; refusing to continue");
  }
  if (db.path !== ":memory:" && state.journalMode.toLowerCase() !== "wal") {
    throw new Error(`SQLite journal_mode is ${state.journalMode}, expected wal`);
  }
  return state;
}

export async function openDatabase(options: OpenOptions): Promise<SqliteDatabase> {
  const memory = options.path === ":memory:";
  if (!memory) mkdirSync(dirname(options.path), { recursive: true });
  const client = createClient({
    url: memory ? ":memory:" : `file:${options.path}`,
    concurrency: 1,
    timeout: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    intMode: "number",
  });
  const db = new SqliteDatabase(client, options.path);
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    if (!memory) {
      await client.execute("PRAGMA journal_mode = WAL");
      await client.execute("PRAGMA synchronous = NORMAL");
    }
    await verifyPragmas(db);
  } catch (error) {
    client.close();
    throw error;
  }
  return db;
}

// --- Migrations (§6.5) ---------------------------------------------------------------------

export interface Migration {
  /** File name, e.g. "0000_initial_schema.sql" — what the ledger records. */
  name: string;
  /** The statements, split on Drizzle's `--> statement-breakpoint` markers. */
  queries: string[];
}

/** The same ledger D1 kept, so the health check and the restore comparison keep working. */
const LEDGER = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(file))
    .sort()
    .map((name) => ({
      name,
      queries: readFileSync(join(dir, name), "utf8")
        .split("--> statement-breakpoint")
        .map((q) => q.trim())
        .filter((q) => q.length > 0),
    }));
}

export async function appliedMigrations(db: SqlDatabase): Promise<string[]> {
  await db.client.execute(LEDGER);
  const rows = await db
    .prepare("SELECT name FROM d1_migrations ORDER BY id")
    .all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

export async function pendingMigrations(db: SqlDatabase, migrations: Migration[]) {
  const applied = new Set(await appliedMigrations(db));
  return migrations.filter((m) => !applied.has(m.name));
}

async function userTableCount(db: SqlDatabase): Promise<number> {
  const row = await db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'",
    )
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * A consistent copy of the live database, taken before any migration runs (§6.5). The last
 * `keep` snapshots are kept next to the database; older ones are removed.
 */
export async function snapshotDatabase(
  db: SqliteDatabase,
  options: { keep?: number; now?: Date } = {},
): Promise<string> {
  if (db.path === ":memory:") throw new Error("Cannot snapshot an in-memory database");
  const dir = dirname(db.path);
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `pre-migrate-${stamp}.db`);
  if (existsSync(target)) rmSync(target);
  await db.client.execute({ sql: "VACUUM INTO ?", args: [target] });
  const keep = options.keep ?? 3;
  const snapshots = readdirSync(dir)
    .filter((f) => /^pre-migrate-.*\.db$/.test(f))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
  for (const old of snapshots.slice(keep)) rmSync(join(dir, old.f), { force: true });
  return target;
}

export interface MigrationReport {
  applied: string[];
  snapshot: string | null;
}

/**
 * Applies pending migrations, each file in ONE transaction together with its ledger row, in name
 * order. Any error stops everything and is thrown (the server then exits non-zero, so Railway's
 * health check keeps the deploy from going live). A snapshot is written first when the database
 * already holds data.
 */
export async function migrate(
  db: SqliteDatabase,
  migrations: Migration[],
  options: { snapshot?: boolean; keepSnapshots?: number; now?: Date } = {},
): Promise<MigrationReport> {
  const pending = await pendingMigrations(db, migrations);
  if (pending.length === 0) return { applied: [], snapshot: null };
  let snapshot: string | null = null;
  if (options.snapshot !== false && db.path !== ":memory:" && (await userTableCount(db)) > 0) {
    snapshot = await snapshotDatabase(db, {
      ...(options.keepSnapshots === undefined ? {} : { keep: options.keepSnapshots }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }
  const applied: string[] = [];
  for (const migration of pending) {
    try {
      await db.client.batch(
        [
          ...migration.queries,
          { sql: "INSERT INTO d1_migrations (name) VALUES (?)", args: [migration.name] },
        ],
        "write",
      );
    } catch (error) {
      throw new MigrationError(migration.name, error, snapshot);
    }
    applied.push(migration.name);
  }
  // A migration can never switch enforcement off behind our back.
  await verifyPragmas(db);
  return { applied, snapshot };
}

export class MigrationError extends Error {
  constructor(
    readonly migration: string,
    cause: unknown,
    readonly snapshot: string | null,
  ) {
    super(`Migration ${migration} failed; nothing from it was applied`, { cause });
    this.name = "MigrationError";
  }
}

// --- Integrity ----------------------------------------------------------------------------

export interface IntegrityReport {
  quickCheck: string;
  foreignKeyViolations: number;
}

export async function integrityCheck(db: SqlDatabase): Promise<IntegrityReport> {
  const quick = await db.client.execute("PRAGMA quick_check");
  const fk = await db.client.execute("PRAGMA foreign_key_check");
  return {
    quickCheck: quick.rows.map((r) => String(r[0])).join("; "),
    foreignKeyViolations: fk.rows.length,
  };
}

/** Name of the database file, for logs (never the full path of a user's machine). */
export function describePath(path: string): string {
  return path === ":memory:" ? ":memory:" : basename(path);
}
