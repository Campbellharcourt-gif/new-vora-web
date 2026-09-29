/**
 * Maintenance mode from the command line on a LOCAL database — for use when the admin toggle is
 * unreachable. Writes the `maintenance` site setting plus an audit row and a security event, in one
 * atomic batch, exactly as the admin toggle does. Takes effect within ~30 s (settings cache).
 *
 *   npm run maintenance -- --on "Back at 3pm AEST"
 *   npm run maintenance -- --off
 *   npm run maintenance -- --db <file> --on
 *
 * Staging/production: from inside the Railway service,
 *   node build/server/index.js maintenance on "Scheduled upgrade"   /   … maintenance off
 * or, when the database itself is the problem, MAINTENANCE_MODE=on and a redeploy
 * (docs/runbooks/operations.md §3).
 */
import { setMaintenance } from "../server/ops";
import { databaseArg, openLocalDatabase } from "./lib/local-db";

const args = process.argv.slice(2);
const onIndex = args.indexOf("--on");
const turnOn = onIndex >= 0;
const turnOff = args.includes("--off");
if (turnOn === turnOff) {
  console.error('Usage: tsx scripts/maintenance.ts [--db <file>] (--on ["message"] | --off)');
  process.exit(1);
}
const next = args[onIndex + 1];
const message = turnOn && next && !next.startsWith("--") ? next.trim().slice(0, 400) : null;

const db = await openLocalDatabase(databaseArg(args));
try {
  await setMaintenance(db, { on: turnOn, message });
  console.log(`Maintenance ${turnOn ? "ON" : "OFF"} (local). Allow ~30 seconds to take effect.`);
} finally {
  db.close();
}
