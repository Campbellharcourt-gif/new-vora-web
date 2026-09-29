import { resolve } from "node:path";
import type { WorkerEnv } from "~/.server/config/env";
import { BackgroundTasks } from "../../server/platform/background";
import { pickAppVariables } from "../../server/platform/config";
import { MemoryMailbox } from "../../server/platform/mailbox";
import { createLimiters } from "../../server/platform/rate-limiter";
import {
  type Migration,
  migrate,
  openDatabase,
  readMigrations,
  type SqliteDatabase,
} from "../../server/platform/sqlite";
import { MemoryStorage } from "../../server/platform/storage";

/**
 * The integration suite's runtime (Railway migration §13.1): what `@cloudflare/vitest-plugin`
 * provided inside workerd, now provided in Node by the REAL platform adapters. Aliased as
 * `cloudflare:test` and `cloudflare:workers` (vitest.integration.config.ts), so the test files
 * are unchanged.
 *
 * - `env`: the platform environment — SQLite (libSQL, `:memory:`, foreign keys on), in-memory
 *   object storage, the in-process rate limiters, the dev mailbox — plus the variables the
 *   integration config sets (the same values workerd had from wrangler.jsonc and Miniflare).
 * - Storage is isolated per test file, as in workerd: Vitest runs each file with a fresh module
 *   graph, so each file gets its own database.
 * - `createExecutionContext` / `waitOnExecutionContext`: the platform's background-task tracker.
 * - `applyD1Migrations`: the server's own migration runner (the same code that runs at start-up).
 */

export type D1Migration = Migration;

const migrations = readMigrations(resolve(process.cwd(), "migrations"));
const database = await openDatabase({ path: ":memory:" });
const limiters = createLimiters();

export const env = {
  ...pickAppVariables(process.env),
  APP_ENV: process.env.APP_ENV ?? "test",
  APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
  DB: database,
  MEDIA: new MemoryStorage(),
  PRIVATE: new MemoryStorage(),
  RL_AUTH: limiters.RL_AUTH,
  RL_FORMS: limiters.RL_FORMS,
  RL_API: limiters.RL_API,
  RL_AI: limiters.RL_AI,
  DEV_MAILBOX: new MemoryMailbox(),
  MIGRATIONS: migrations.map((m) => m.name),
  TEST_MIGRATIONS: migrations,
} satisfies WorkerEnv & { TEST_MIGRATIONS: D1Migration[] };

export async function applyD1Migrations(db: unknown, list: D1Migration[]): Promise<void> {
  await migrate(db as SqliteDatabase, list, { snapshot: false });
}

const trackers = new WeakMap<ExecutionContext, BackgroundTasks>();

export function createExecutionContext(): ExecutionContext {
  const tasks = new BackgroundTasks((error) => {
    // Background failures are logged by the application itself; surface anything unexpected.
    console.error("background task rejected:", error);
  });
  const ctx = tasks.context();
  trackers.set(ctx, tasks);
  return ctx;
}

export async function waitOnExecutionContext(ctx: ExecutionContext): Promise<void> {
  await trackers.get(ctx)?.drain(60_000);
}
