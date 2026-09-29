/**
 * Applies base seed data (roles, permissions, social links and DRAFT content) to a LOCAL database.
 *
 *   npm run db:seed:local                 # .vora/dev.db
 *   tsx scripts/seed.ts --db <file>       # another local file (the E2E and HTTPS harnesses)
 *
 * Staging/production are seeded from inside the Railway service with
 * `node build/server/index.js seed` (docs/runbooks/deployment.md) — never from here.
 * Idempotent: RBAC rows are upserted from code; content rows are inserted only if missing.
 */
import { applyBaseSeed } from "../server/ops";
import { databaseArg, openLocalDatabase } from "./lib/local-db";

const path = databaseArg(process.argv.slice(2));
const db = await openLocalDatabase(path);
try {
  console.log(`Seeding ${path}…`);
  const count = await applyBaseSeed(db);
  console.log(`Seed complete (${count} statements). Content was inserted as DRAFTS only.`);
} finally {
  db.close();
}
