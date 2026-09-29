/**
 * LOCAL DEVELOPMENT ONLY: creates one active user per role in a local database so every area can
 * be exercised. Only ever works on a local SQLite file. Passwords are printed once.
 *
 *   npm run dev:users                                   # .vora/dev.db
 *   tsx scripts/dev-users.ts --db <file> [--set sec] [--out .wrangler/e2e-state/users.json]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDevUsers } from "./lib/dev-users";
import { databaseArg, openLocalDatabase } from "./lib/local-db";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = option("--out");
// Credentials are written only inside git-ignored local-state directories.
if (out && ![".wrangler", ".vora"].some((dir) => resolve(out).startsWith(resolve(dir)))) {
  console.error(
    "--out must be inside .vora/ or .wrangler/ (git-ignored) so credentials are never committed.",
  );
  process.exit(1);
}

const db = await openLocalDatabase(databaseArg(args));
try {
  const { credentials, printed } = await createDevUsers(db, option("--set"));
  if (out) writeFileSync(out, JSON.stringify(credentials, null, 2));
  console.log("\nLocal development users (sign-in codes appear at /api/dev/mailbox):\n");
  console.log(printed.join("\n"));
} finally {
  db.close();
}
