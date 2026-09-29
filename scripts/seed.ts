/**
 * Applies base seed data (roles, permissions, social links and DRAFT content) to a D1 database.
 *
 *   npm run db:seed:local                 # local Miniflare database
 *   tsx scripts/seed.ts --local --persist-to .wrangler/e2e-state   # a separate local state dir
 *   npm run db:seed:staging               # staging (remote)
 *   npm run db:seed:production            # production (asks for confirmation)
 *
 * Idempotent: RBAC rows are upserted from code; content rows are inserted only if missing.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseSeedStatements } from "../app/.server/db/seed/sql";

const args = process.argv.slice(2);
const local = args.includes("--local");
const envIndex = args.indexOf("--env");
const env = envIndex >= 0 ? args[envIndex + 1] : undefined;
if (!local && env !== "staging" && env !== "production") {
  console.error("Usage: tsx scripts/seed.ts --local | --env staging | --env production");
  process.exit(1);
}

const dir = join(process.cwd(), ".wrangler", "tmp");
mkdirSync(dir, { recursive: true });
const file = join(dir, `seed-${Date.now()}.sql`);
writeFileSync(file, `${baseSeedStatements().join("\n")}\n`);

const wranglerArgs = ["wrangler", "d1", "execute", "DB", "--file", file, "--yes"];
const persistIndex = args.indexOf("--persist-to");
if (local) {
  wranglerArgs.push("--local");
  // Optional separate local state directory (used by the E2E suite).
  if (persistIndex >= 0) wranglerArgs.push("--persist-to", args[persistIndex + 1] as string);
} else wranglerArgs.push("--env", env as string, "--remote");

console.log(`Seeding ${local ? "local" : env} database…`);
execFileSync("npx", wranglerArgs, { stdio: "inherit" });
console.log("Seed complete. Content was inserted as DRAFTS only.");
