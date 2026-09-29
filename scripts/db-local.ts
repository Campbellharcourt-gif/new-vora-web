/**
 * LOCAL database maintenance (the development database unless `--db <file>`):
 *
 *   npm run db:migrate:local                 # apply pending migrations (the server also does this)
 *   npm run db:integrity:local               # quick_check, foreign_key_check, PRAGMAs
 *
 * Staging/production run the same from inside the Railway service:
 *   node build/server/index.js migrate | integrity
 */
import { resolve } from "node:path";
import {
  integrityCheck,
  migrate,
  openDatabase,
  readMigrations,
  readPragmas,
} from "../server/platform/sqlite";
import { databaseArg } from "./lib/local-db";

const [command, ...rest] = process.argv.slice(2);
const path = resolve(databaseArg(rest));
const db = await openDatabase({ path });
try {
  if (command === "migrate") {
    const report = await migrate(db, readMigrations(resolve("migrations")));
    console.log(
      `Migrations: ${report.applied.length ? `applied ${report.applied.join(", ")}` : "none pending"}${report.snapshot ? ` (snapshot ${report.snapshot})` : ""}`,
    );
  } else if (command === "integrity") {
    const report = await integrityCheck(db);
    const pragmas = await readPragmas(db);
    console.log(`quick_check: ${report.quickCheck}`);
    console.log(`foreign_key_check violations: ${report.foreignKeyViolations}`);
    console.log(`foreign_keys=${pragmas.foreignKeys} journal_mode=${pragmas.journalMode}`);
    process.exitCode = report.quickCheck === "ok" && report.foreignKeyViolations === 0 ? 0 : 1;
  } else {
    console.error("Usage: tsx scripts/db-local.ts migrate|integrity [--db <file>]");
    process.exitCode = 2;
  }
} finally {
  db.close();
}
