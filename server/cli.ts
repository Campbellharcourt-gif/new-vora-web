import type { WorkerEnv } from "../app/.server/config/env";
import type { AppModule } from "./app";
import { applyBaseSeed, setMaintenance } from "./ops";
import { PlatformConfigError, pickAppVariables, readPlatformConfig } from "./platform/config";
import {
  integrityCheck,
  migrate,
  openDatabase,
  readMigrations,
  readPragmas,
} from "./platform/sqlite";

/**
 * Operator commands inside the production image (Railway migration §2 items 21–22):
 *
 *   node build/server/index.js check                  configuration + Argon2id self-test (no writes)
 *   node build/server/index.js migrate                apply pending migrations and exit
 *   node build/server/index.js seed                   base seed (roles, permissions, DRAFT content)
 *   node build/server/index.js maintenance on "msg"   maintenance mode on (audited)
 *   node build/server/index.js maintenance off
 *   node build/server/index.js integrity              quick_check + foreign_key_check
 *   node build/server/index.js query "<SELECT …>"     read-only SQL, rows as JSON
 *   node build/server/index.js exec "<one statement>" --confirm-write
 *                                                     one write, for the runbook procedures only
 *
 * On Railway they run inside the service (`railway ssh`), where the volume is mounted — NOT
 * VERIFIED until staging. They print names and counts only, never values.
 */
export async function runCli(
  args: string[],
  app: AppModule,
  paths: { migrationsDir: string; defaultDatabasePath: string },
  vars: Record<string, string | undefined> = process.env,
): Promise<number> {
  const [command, ...rest] = args;
  const out = (line: string) => process.stdout.write(`${line}\n`);
  let config: ReturnType<typeof readPlatformConfig>;
  try {
    config = readPlatformConfig(vars, { databasePath: paths.defaultDatabasePath });
  } catch (error) {
    const keys = error instanceof PlatformConfigError ? error.invalidKeys : [String(error)];
    out(`Invalid platform configuration:\n  ${keys.join("\n  ")}`);
    return 1;
  }

  if (command === "check") {
    try {
      app.getConfig(pickAppVariables(vars) as unknown as WorkerEnv);
    } catch (error) {
      const internal = (error as { internal?: { invalidKeys?: string[] } }).internal;
      out(
        `Invalid application configuration:\n  ${(internal?.invalidKeys ?? [String(error)]).join("\n  ")}`,
      );
      return 1;
    }
    try {
      await app.argon2SelfTest();
      out("Argon2id self-test: ok");
    } catch (error) {
      out(`Argon2id self-test FAILED: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    out("Platform and application configuration: ok");
    return 0;
  }

  const db = await openDatabase({ path: config.databasePath });
  try {
    switch (command) {
      case "migrate": {
        const report = await migrate(db, readMigrations(paths.migrationsDir));
        out(
          `Migrations applied: ${report.applied.length ? report.applied.join(", ") : "none pending"}`,
        );
        return 0;
      }
      case "seed": {
        await migrate(db, readMigrations(paths.migrationsDir));
        const count = await applyBaseSeed(db);
        out(`Seed applied (${count} statements). Content was inserted as DRAFTS only.`);
        return 0;
      }
      case "maintenance": {
        const mode = rest[0];
        if (mode !== "on" && mode !== "off") {
          out('Usage: maintenance on ["message"] | maintenance off');
          return 2;
        }
        const message = mode === "on" && rest[1] ? rest[1].trim().slice(0, 400) : null;
        await setMaintenance(db, { on: mode === "on", message });
        out(
          `Maintenance ${mode.toUpperCase()}. Allow ~30 seconds to take effect (settings cache).`,
        );
        return 0;
      }
      case "integrity": {
        const report = await integrityCheck(db);
        const pragmas = await readPragmas(db);
        out(`quick_check: ${report.quickCheck}`);
        out(`foreign_key_check violations: ${report.foreignKeyViolations}`);
        out(`foreign_keys: ${pragmas.foreignKeys} · journal_mode: ${pragmas.journalMode}`);
        return report.quickCheck === "ok" && report.foreignKeyViolations === 0 ? 0 : 1;
      }
      case "query": {
        const sql = rest[0] ?? "";
        // Read-only: one SELECT / WITH / EXPLAIN / PRAGMA statement, nothing after it.
        if (!/^\s*(select|with|explain|pragma)\b/i.test(sql) || /;\s*\S/.test(sql)) {
          out("query takes ONE read-only statement (SELECT, WITH, EXPLAIN or PRAGMA).");
          return 2;
        }
        const result = await db.client.execute(sql);
        out(
          JSON.stringify(
            result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]]))),
            null,
            2,
          ),
        );
        return 0;
      }
      case "exec": {
        const sql = rest[0] ?? "";
        if (!rest.includes("--confirm-write") || /;\s*\S/.test(sql) || !sql.trim()) {
          out(
            "exec takes ONE statement and --confirm-write. It bypasses the application audit log: record who ran it and why.",
          );
          return 2;
        }
        const result = await db.client.execute(sql);
        out(`Rows affected: ${result.rowsAffected}`);
        return 0;
      }
      default:
        out(
          "Commands: serve (default) · check · migrate · seed · maintenance on|off · integrity · query · exec",
        );
        return 2;
    }
  } finally {
    db.close();
  }
}
