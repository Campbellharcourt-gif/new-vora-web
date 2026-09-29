import { resolve } from "node:path";
import {
  migrate,
  openDatabase,
  readMigrations,
  type SqliteDatabase,
} from "../../server/platform/sqlite";

/** The development database (`npm run dev` uses the same default). */
export const DEV_DATABASE = ".vora/dev.db";

/**
 * Opens a LOCAL SQLite database file and applies pending migrations — what the server does at
 * start-up. Scripts never touch a remote database: staging and production are changed only from
 * inside the Railway service (`node build/server/index.js <command>`, docs/runbooks/deployment.md).
 */
export async function openLocalDatabase(path: string): Promise<SqliteDatabase> {
  const db = await openDatabase({ path: resolve(path) });
  await migrate(db, readMigrations(resolve("migrations")), { snapshot: false });
  return db;
}

/** `--db <path>` from the command line, or the development database. */
export function databaseArg(args: string[]): string {
  const index = args.indexOf("--db");
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--db needs a file path");
    return value;
  }
  // Refuse the old Wrangler flags explicitly rather than ignoring them.
  if (args.includes("--remote") || args.includes("--env")) {
    throw new Error(
      "Scripts only work on local database files. Staging/production: see docs/runbooks/deployment.md.",
    );
  }
  return DEV_DATABASE;
}
