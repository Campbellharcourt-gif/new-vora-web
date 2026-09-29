/**
 * E2E only: three throwaway local databases for the three production servers
 * (scripts/e2e-servers.ts). Railway migration §6.8: separate SQLite files replace the three
 * Wrangler state directories. The directory names are unchanged, so the E2E specs (which read
 * `.wrangler/e2e-state/users.json`) are unchanged; `.wrangler/` is git-ignored local state.
 *
 *   .wrangler/e2e-state/vora.db             migrated, seeded, one dev user per role (+ the "sec" set)
 *   .wrangler/e2e-setup-state/vora.db       migrated, seeded, no users — /setup in a normal browser
 *   .wrangler/e2e-setup-nojs-state/vora.db  the same, for /setup without JavaScript
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { applyBaseSeed } from "../server/ops";
import { createDevUsers } from "./lib/dev-users";
import { openLocalDatabase } from "./lib/local-db";

const MAIN = ".wrangler/e2e-state";
const SETUP = ".wrangler/e2e-setup-state";
const SETUP_NOJS = ".wrangler/e2e-setup-nojs-state";

for (const dir of [MAIN, SETUP, SETUP_NOJS]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

const main = await openLocalDatabase(`${MAIN}/vora.db`);
try {
  await applyBaseSeed(main);
  const users = await createDevUsers(main);
  writeFileSync(`${MAIN}/users.json`, JSON.stringify(users.credentials, null, 2));
  const sec = await createDevUsers(main, "sec");
  writeFileSync(`${MAIN}/users-sec.json`, JSON.stringify(sec.credentials, null, 2));
} finally {
  main.close();
}

const setup = await openLocalDatabase(`${SETUP}/vora.db`);
try {
  await applyBaseSeed(setup);
  // A consistent single-file copy (no WAL sidecar) for the no-JavaScript server.
  await setup.client.execute({ sql: "VACUUM INTO ?", args: [`${SETUP_NOJS}/vora.db`] });
} finally {
  setup.close();
}
console.log("E2E: three throwaway local databases prepared under .wrangler/ (git-ignored).");
