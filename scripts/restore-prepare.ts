/**
 * Prepares a D1 SQL export (from `npm run backup:export`) for import into an EMPTY database
 * (backup-and-recovery.md §3.2). A local file transformation only: it never contacts Cloudflare,
 * never changes a statement, and never prints the file's contents (they hold personal data).
 *
 *   npm run db:restore-prepare -- backups/vora-production-<stamp>.sql
 *   → backups/vora-production-<stamp>.restore.sql
 *
 * Why: see scripts/lib/sql-dump.ts. An unmodified export stops with "no such table: main.users"
 * when imported into an empty database (verified locally, CP-2.1 · A2).
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { prepareRestore } from "./lib/sql-dump";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const outIndex = args.indexOf("--out");
if (!input || args.includes("--help")) {
  console.error("Usage: tsx scripts/restore-prepare.ts <export.sql> [--out <file.restore.sql>]");
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`Not found: ${input}`);
  process.exit(1);
}
const output =
  outIndex >= 0 ? (args[outIndex + 1] as string) : input.replace(/(\.sql)?$/i, ".restore.sql");
if (output === input) {
  console.error("Refusing to overwrite the export itself; choose another --out.");
  process.exit(2);
}

const prepared = prepareRestore(readFileSync(input, "utf8"));
writeFileSync(output, prepared.sql);
const { pragma, table, data, schema } = prepared.counts;
console.log(`Prepared ${output} (${statSync(output).size} bytes)`);
console.log(
  `  ${table} tables first, then ${data} data statements (parents before children), then ${schema} indexes/triggers/views; ${pragma} pragma.`,
);
console.log("  Statements are reordered only, never changed. Import it into an EMPTY database.");
