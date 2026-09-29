/**
 * A point-in-time copy of a VORA database, as a single SQLite file under `backups/` (git-ignored;
 * it holds personal data — never commit or share it). Railway migration §6.9.
 *
 *   npm run backup:export -- --db .vora/dev.db
 *       A local database: a consistent copy with `VACUUM INTO`.
 *
 *   npm run backup:export -- --env staging|production
 *       The latest Litestream replica in that environment's R2 backups bucket, restored to a local
 *       file with `litestream restore` (read-only on R2 — nothing on Railway or in R2 changes).
 *       Needs the `litestream` binary (v0.5.x) and an R2 token with READ access to the bucket in
 *       LITESTREAM_ACCESS_KEY_ID / LITESTREAM_SECRET_ACCESS_KEY, plus R2_ACCOUNT_ID.
 *       NOT VERIFIED until staging exists (docs/runbooks/backup-and-recovery.md).
 *
 * Then `npm run db:integrity:local -- --db <the file>`; to restore, see the runbook.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../server/platform/sqlite";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = resolve("backups");
mkdirSync(dir, { recursive: true });

const env = option("--env");
const local = option("--db");
if (local) {
  const target = join(dir, `local-${stamp}.db`);
  const db = await openDatabase({ path: resolve(local) });
  try {
    await db.client.execute({ sql: "VACUUM INTO ?", args: [target] });
  } finally {
    db.close();
  }
  console.log(`Copied ${local} → ${target} (${statSync(target).size} bytes)`);
} else if (env === "staging" || env === "production") {
  const bucket = env === "production" ? "vora-backups" : "vora-backups-staging";
  const account = process.env.R2_ACCOUNT_ID;
  if (
    !account ||
    !process.env.LITESTREAM_ACCESS_KEY_ID ||
    !process.env.LITESTREAM_SECRET_ACCESS_KEY
  ) {
    console.error(
      "Set R2_ACCOUNT_ID, LITESTREAM_ACCESS_KEY_ID and LITESTREAM_SECRET_ACCESS_KEY (a READ-only R2 token).",
    );
    process.exit(1);
  }
  const target = join(dir, `vora-${env}-${stamp}.db`);
  execFileSync(
    "litestream",
    [
      "restore",
      "-o",
      target,
      `s3://${bucket}/vora.db?endpoint=https://${account}.r2.cloudflarestorage.com&region=auto`,
    ],
    { stdio: "inherit" },
  );
  console.log(`Restored the latest ${env} replica → ${target} (${statSync(target).size} bytes)`);
} else {
  console.error("Usage: tsx scripts/backup-export.ts --db <local file> | --env staging|production");
  process.exit(1);
}
