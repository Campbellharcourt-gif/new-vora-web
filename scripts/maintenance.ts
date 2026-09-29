/**
 * Maintenance mode from the command line — for use before the admin toggle exists, or when the
 * admin is unreachable. Writes the `maintenance` site setting plus an audit row and a security
 * event, exactly as the admin toggle does. Takes effect within ~30 s (per-isolate settings cache).
 *
 *   npm run maintenance -- --local --on "Back at 3pm AEST"
 *   npm run maintenance -- --env staging --off
 *   npm run maintenance -- --env production --on "Scheduled upgrade"   # asks you to type "production"
 *
 * For an outage where the database itself is the problem, use MAINTENANCE_MODE=on in the
 * environment's vars and redeploy instead (docs/runbooks/operations.md §3).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lit } from "../app/.server/db/seed/sql";
import { newId } from "../app/.server/lib/ids";

const args = process.argv.slice(2);
const local = args.includes("--local");
const envIndex = args.indexOf("--env");
const env = envIndex >= 0 ? args[envIndex + 1] : undefined;
const onIndex = args.indexOf("--on");
const turnOn = onIndex >= 0;
const turnOff = args.includes("--off");

if ((!local && env !== "staging" && env !== "production") || turnOn === turnOff) {
  console.error(
    'Usage: tsx scripts/maintenance.ts (--local | --env staging|production) (--on ["message"] | --off)',
  );
  process.exit(1);
}

const next = args[onIndex + 1];
const message = turnOn && next && !next.startsWith("--") ? next.trim().slice(0, 400) : null;
const value = { enabled: turnOn, message };

if (env === "production") {
  try {
    execFileSync(
      "node",
      ["scripts/confirm.mjs", `Turn maintenance ${turnOn ? "ON" : "OFF"} in PRODUCTION`],
      { stdio: "inherit" },
    );
  } catch {
    process.exit(1); // confirm.mjs already printed "Cancelled."
  }
}

const now = Date.now();
const json = (v: unknown) => lit(JSON.stringify(v));
const sql = [
  `INSERT INTO site_settings (key, value, updated_at) VALUES ('maintenance', ${json(value)}, ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = NULL, updated_at = excluded.updated_at;`,
  `INSERT INTO audit_logs (id, action, target_type, target_id, summary, changes, created_at) VALUES (${lit(newId("audit", now))}, 'settings.update', 'setting', 'maintenance', ${lit(`Maintenance ${turnOn ? "enabled" : "disabled"} from the command line`)}, ${json({ to: value, via: "cli" })}, ${now});`,
  `INSERT INTO security_events (id, type, severity, details, created_at) VALUES (${lit(newId("securityEvent", now))}, 'maintenance.changed', 'medium', ${json({ enabled: turnOn, via: "cli" })}, ${now});`,
];

const dir = join(process.cwd(), ".wrangler", "tmp");
mkdirSync(dir, { recursive: true });
const file = join(dir, `maintenance-${now}.sql`);
writeFileSync(file, `${sql.join("\n")}\n`);

const wranglerArgs = ["wrangler", "d1", "execute", "DB", "--file", file, "--yes"];
if (local) wranglerArgs.push("--local");
else wranglerArgs.push("--env", env as string, "--remote");
execFileSync("npx", wranglerArgs, { stdio: "inherit" });
console.log(
  `Maintenance ${turnOn ? "ON" : "OFF"} (${local ? "local" : env}). Allow ~30 seconds to take effect everywhere.`,
);
