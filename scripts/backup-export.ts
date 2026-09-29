/**
 * Logical backup of a remote D1 database (complements D1 Time Travel's 30-day point-in-time
 * restore). Writes a timestamped SQL export and, with --upload, stores it in the R2 backup bucket.
 *
 *   npm run backup:export -- --env production [--upload]
 *
 * Credentials: your `npx wrangler login` session, or — for unattended runs such as a scheduled
 * job — a CLOUDFLARE_API_TOKEN with D1 read (and R2 write for --upload). To restore an export into
 * an empty database, prepare it first with `npm run db:restore-prepare` (backup-and-recovery.md §3.2).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env");
const env = envIndex >= 0 ? args[envIndex + 1] : undefined;
if (env !== "staging" && env !== "production") {
  console.error("Usage: tsx scripts/backup-export.ts --env staging|production [--upload]");
  process.exit(1);
}
const database = env === "production" ? "vora-production" : "vora-staging";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(process.cwd(), "backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${database}-${stamp}.sql`);

execFileSync(
  "npx",
  ["wrangler", "d1", "export", database, "--remote", "--output", file, "--env", env],
  {
    stdio: "inherit",
  },
);
console.log(`Exported ${database} → ${file}`);

if (args.includes("--upload")) {
  execFileSync(
    "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      `vora-backups/d1/${database}/${stamp}.sql`,
      "--file",
      file,
      "--remote",
    ],
    { stdio: "inherit" },
  );
  console.log("Uploaded to R2 bucket vora-backups.");
}
