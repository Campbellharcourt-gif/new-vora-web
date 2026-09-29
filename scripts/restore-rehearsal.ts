/**
 * LOCAL ONLY — rehearses backup-and-recovery.md §3.2 ("restore from an export into a fresh
 * database") end to end on throwaway local databases (CP-2.1 · A2). It never contacts
 * Cloudflare: every wrangler call is `--local`, against configs generated under
 * .wrangler/restore-rehearsal/ (git-ignored), and `--remote` is refused.
 *
 *   npm run db:restore-rehearsal              # add `-- --keep` to keep .wrangler/restore-rehearsal/
 *
 *  1. source   — a fresh local database: migrations, seed content.
 *  2. activity — the production build (vite preview) on the source database: the first Owner via
 *                /setup, a public enquiry, a failed and a successful Owner sign-in (password +
 *                emailed code). Real rows in the auth, audit, security and enquiry tables.
 *  3. export   — `wrangler d1 export DB --local` (backup:export runs the same with --remote).
 *  4. restore  — into FRESH, empty databases: the export as-is (reported for information), and
 *                the file from `npm run db:restore-prepare` (the documented procedure).
 *  5. compare  — schema objects, per-table row counts and SHA-256 of all rows, sqlite_sequence,
 *                applied migrations, quick_check, foreign_key_check, and the protective
 *                triggers still firing.
 *  6. app      — the production build on the RESTORED database: health, /setup stays closed,
 *                the Owner signs in with password + a recovery code issued before the export,
 *                and the enquiry is listed in the admin workspace.
 *
 * Prints no secrets, codes, passwords or row contents — only names, counts, digests and results.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { prepareRestore } from "./lib/sql-dump";

const ROOT = process.cwd();
const WORK = resolve(ROOT, ".wrangler/restore-rehearsal");
const WRANGLER = resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");
const VITE = resolve(ROOT, "node_modules/vite/bin/vite.js");
const PORT = 5190;
const BASE = `http://localhost:${PORT}`;
const OWNER = { name: "Rehearsal Owner", email: "owner.rehearsal@vora.test" };

const args = process.argv.slice(2);
if (args.includes("--remote") || args.some((a) => a.startsWith("--env"))) {
  console.error("The restore rehearsal is local-only. It never takes --remote or --env.");
  process.exit(2);
}
const keep = args.includes("--keep");

// Children never inherit an environment selection: this is always the LOCAL configuration.
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_SEND_ERROR_REPORTS: "false",
  NO_COLOR: "1", // plain text, so errors can be quoted in the summary
  FORCE_COLOR: "0",
};
delete childEnv.CLOUDFLARE_ENV;

// ---------------------------------------------------------------------------------------------
// Results

type Outcome = "PASS" | "FAIL" | "INFO";
const results: { step: string; outcome: Outcome; detail: string }[] = [];
function record(step: string, ok: boolean | "info", detail: string) {
  const outcome: Outcome = ok === "info" ? "INFO" : ok ? "PASS" : "FAIL";
  results.push({ step, outcome, detail });
  console.log(`  ${outcome.padEnd(4)}  ${step} — ${detail}`);
}
function check(step: string, ok: boolean, detail: string) {
  record(step, ok, detail);
  return ok;
}

// ---------------------------------------------------------------------------------------------
// Local databases (each has its own generated config; state lives next to it)

interface LocalDb {
  label: string;
  dir: string;
  config: string;
  state: string;
}

function localDb(label: string): LocalDb {
  const dir = join(WORK, label);
  mkdirSync(dir, { recursive: true });
  const config = join(dir, "wrangler.json");
  // Same database_id as the project's local binding, so seed.ts and vite preview (which use the
  // project config with an explicit state directory) address the same SQLite file.
  writeFileSync(
    config,
    JSON.stringify(
      {
        name: "vora-restore-rehearsal",
        compatibility_date: "2026-09-25",
        d1_databases: [
          {
            binding: "DB",
            database_name: "vora-local",
            database_id: "vora-local",
            migrations_dir: resolve(ROOT, "migrations"),
          },
        ],
      },
      null,
      2,
    ),
  );
  return { label, dir, config, state: join(dir, ".wrangler", "state") };
}

function assertLocal(wranglerArgs: string[]) {
  if (wranglerArgs.includes("--remote") || !wranglerArgs.includes("--local"))
    throw new Error(`Refusing a non-local wrangler call: wrangler ${wranglerArgs.join(" ")}`);
}

function wrangler(wranglerArgs: string[]): { ok: boolean; stdout: string; stderr: string } {
  assertLocal(wranglerArgs);
  const run = spawnSync(process.execPath, [WRANGLER, ...wranglerArgs], {
    cwd: ROOT,
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { ok: run.status === 0, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

// Wrangler colours its errors even when asked not to; strip the escape sequences for the summary.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function firstError(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.replace(ANSI, "").trim())
    .find((l) => /ERROR|error|SQLITE_/.test(l) && !/Logs were written/.test(l));
  return (line ?? "unknown error").replace(/^✘\s*\[ERROR\]\s*/, "").slice(0, 160);
}

function parseJson(stdout: string): unknown {
  const start = stdout.search(/^[[{]/m);
  if (start < 0) throw new Error("wrangler printed no JSON");
  return JSON.parse(stdout.slice(start));
}

/** Runs one or more statements; returns each statement's rows. Throws on SQL errors. */
function query(db: LocalDb, sql: string): Record<string, unknown>[][] {
  const run = wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    db.config,
    "--json",
    "--command",
    sql,
  ]);
  const parsed = parseJson(run.stdout) as
    | { results: Record<string, unknown>[] }[]
    | { error?: { text?: string } };
  if (!Array.isArray(parsed))
    throw new Error(parsed.error?.text ?? firstError(run.stdout + run.stderr));
  return parsed.map((r) => r.results);
}

/** A statement that must be refused (the protective triggers). Returns the error text. */
function refused(db: LocalDb, sql: string): string | null {
  const run = wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    db.config,
    "--json",
    "--command",
    sql,
  ]);
  const text = `${run.stdout}\n${run.stderr}`;
  return run.ok && !/"error"/.test(run.stdout) ? null : text;
}

function tablesOf(db: LocalDb): string[] {
  return (
    query(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY name",
    )[0] ?? []
  ).map((r) => String(r.name));
}

function schemaOf(db: LocalDb): string[] {
  return (
    query(
      db,
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY type, name",
    )[0] ?? []
  ).map((r) => JSON.stringify([r.type, r.name, r.tbl_name, r.sql]));
}

/** Row count and SHA-256 over every row of every table (order-independent). */
function fingerprint(db: LocalDb, tables: string[]): Map<string, { rows: number; sha256: string }> {
  const names = [...tables, "sqlite_sequence"];
  const sql = names.map((t) => `SELECT * FROM "${t.replaceAll('"', '""')}";`).join(" ");
  const sets = query(db, sql);
  const out = new Map<string, { rows: number; sha256: string }>();
  names.forEach((name, i) => {
    const rows = (sets[i] ?? []).map((row) => JSON.stringify(Object.entries(row))).sort();
    out.set(name, {
      rows: rows.length,
      sha256: createHash("sha256").update(rows.join("\n")).digest("hex"),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The production build, served by vite preview (workerd) on one database at a time

let server: ChildProcess | null = null;

async function startApp(db: LocalDb): Promise<void> {
  const log = openSync(join(WORK, `app-${db.label}.log`), "w");
  server = spawn(process.execPath, [VITE, "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    env: { ...childEnv, VORA_LOCAL_STATE: relative(ROOT, db.state) },
    stdio: ["ignore", log, log],
    detached: true,
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`The app exited early (see ${relative(ROOT, WORK)}/app-${db.label}.log).`);
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("The app did not become healthy within 90 s.");
}

async function stopApp(): Promise<void> {
  const child = server;
  server = null;
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  try {
    process.kill(-child.pid, "SIGTERM"); // the whole group: vite and its workerd processes
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  // Wait until the port is free so the database files are no longer in use.
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${BASE}/api/health`);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      return;
    }
  }
}

/** A tiny browser: keeps cookies, sends same-origin form posts, never follows redirects itself. */
class Browser {
  private cookies = new Map<string, string>();

  async go(path: string, form?: Record<string, string>): Promise<Response> {
    const headers = new Headers();
    if (this.cookies.size)
      headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let body: URLSearchParams | undefined;
    if (form) {
      body = new URLSearchParams(form);
      headers.set("content-type", "application/x-www-form-urlencoded");
      headers.set("origin", BASE);
      headers.set("sec-fetch-site", "same-origin");
    }
    const res = await fetch(`${BASE}${path}`, {
      method: form ? "POST" : "GET",
      headers,
      body,
      redirect: "manual",
    });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  /** Follows up to five same-site redirects; returns the final response and path. */
  async follow(
    path: string,
    form?: Record<string, string>,
  ): Promise<{ res: Response; path: string }> {
    let res = await this.go(path, form);
    let at = path;
    for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400; hop += 1) {
      const target = new URL(res.headers.get("location") ?? "/", BASE);
      at = `${target.pathname}${target.search}`;
      res = await this.go(at);
    }
    return { res, path: at };
  }
}

async function latestSignInCode(browser: Browser, email: string): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const res = await browser.go(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
    const body = (await res.json()) as { messages: { subject: string; text: string }[] };
    const text = body.messages.find((m) => /sign-in code/.test(m.subject))?.text;
    const code = text ? /\b(\d{6})\b/.exec(text)?.[1] : undefined;
    if (code) return code;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("No sign-in code arrived in the local mailbox.");
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  console.log("Restore rehearsal (LOCAL ONLY — nothing is sent to Cloudflare)\n");
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const source = localDb("source");
  const raw = localDb("restored-raw");
  const restored = localDb("restored");

  console.log("1. Source: a fresh local database (migrations + seed)");
  const migrate = wrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    source.config,
  ]);
  if (
    !check(
      "source migrations",
      migrate.ok,
      migrate.ok ? "applied" : firstError(migrate.stdout + migrate.stderr),
    )
  )
    throw new Error("stop");
  execFileSync("npx", ["tsx", "scripts/seed.ts", "--local", "--persist-to", source.state], {
    cwd: ROOT,
    env: childEnv,
    stdio: "ignore",
  });
  record("source seed", true, "content seeded");

  console.log("\n2. Activity through the production build on the source database");
  execFileSync("npx", ["react-router", "build"], { cwd: ROOT, env: childEnv, stdio: "ignore" });
  execFileSync(process.execPath, ["scripts/e2e-secrets.mjs"], {
    cwd: ROOT,
    env: childEnv,
    stdio: "ignore",
  });
  const vars = readFileSync(join(ROOT, "build", "server", ".dev.vars"), "utf8");
  const setupToken = /^SETUP_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim() ?? "";
  record("build", true, "local production build with throwaway secrets (build/server/.dev.vars)");

  const password = `Rh-${randomBytes(9).toString("base64url")}-9`;
  let recoveryCode = "";
  let reference = "";
  await startApp(source);
  try {
    const owner = new Browser();
    const setup = await owner.go("/setup", {
      setupToken,
      name: OWNER.name,
      email: OWNER.email,
      password,
      confirmPassword: password,
    });
    const setupHtml = await setup.text();
    const codes = [...setupHtml.matchAll(/<li>([0-9A-Z]{5}-[0-9A-Z]{5})<\/li>/g)].map(
      (m) => m[1] as string,
    );
    recoveryCode = codes[0] ?? "";
    check(
      "first Owner via /setup",
      setup.status === 200 && codes.length === 10,
      `status ${setup.status}, ${codes.length} recovery codes shown`,
    );

    const visitor = new Browser();
    const contact = await (await visitor.go("/contact")).text();
    const formToken = /name="formToken" value="([^"]+)"/.exec(contact)?.[1] ?? "";
    const timelineInput = /<input[^>]*name="timeline"[^>]*>/.exec(contact)?.[0] ?? "";
    const timeline = /value="([^"]+)"/.exec(timelineInput)?.[1] ?? "";
    await new Promise((r) => setTimeout(r, 3500)); // the signed form token rejects bot-speed posts
    const enquiry = await visitor.go("/contact", {
      formToken,
      name: "Rehearsal Visitor",
      email: "visitor.rehearsal@example.test",
      company: "Rehearsal Ltd",
      projectTypes: "websites",
      timeline,
      message: "Restore rehearsal enquiry: a new website with a booking flow, please.",
      consent: "on",
    });
    reference = /VR-[0-9A-HJKMNP-TV-Z]{6}/.exec(await enquiry.text())?.[0] ?? "";
    check(
      "public enquiry",
      enquiry.status === 200 && reference !== "",
      `status ${enquiry.status}, reference ${reference ? "issued" : "missing"}`,
    );

    const wrong = await new Browser().go("/login", {
      email: OWNER.email,
      password: "not-the-password-1",
    });
    check("failed sign-in recorded", wrong.status === 401, `status ${wrong.status}`);

    const signIn = new Browser();
    const first = await signIn.follow("/login", { email: OWNER.email, password, next: "/admin" });
    const code = await latestSignInCode(signIn, OWNER.email);
    const verified = await signIn.follow("/login/verify", { code, next: "/admin" });
    check(
      "Owner sign-in (password + emailed code)",
      first.path.startsWith("/login/verify") &&
        verified.path === "/admin" &&
        verified.res.status === 200,
      `landed on ${verified.path} (${verified.res.status})`,
    );
  } finally {
    await stopApp();
  }

  const sourceTables = tablesOf(source);
  const before = fingerprint(source, sourceTables);
  const needRows = [
    "users",
    "user_roles",
    "mfa_factors",
    "recovery_codes",
    "sessions",
    "login_attempts",
    "security_events",
    "audit_logs",
    "enquiries",
    "email_outbox",
    "d1_migrations",
  ];
  const empty = needRows.filter((t) => (before.get(t)?.rows ?? 0) === 0);
  check(
    "source has real rows to restore",
    empty.length === 0,
    empty.length
      ? `empty: ${empty.join(", ")}`
      : `${needRows.length} key tables populated; ${sourceTables.length} tables, ${[...before.values()].reduce((n, t) => n + t.rows, 0)} rows in total`,
  );

  console.log("\n3. Export (wrangler d1 export --local)");
  const exportFile = join(WORK, "export.sql");
  const t0 = Date.now();
  const exported = wrangler([
    "d1",
    "export",
    "DB",
    "--local",
    "--config",
    source.config,
    "--output",
    exportFile,
  ]);
  if (
    !check(
      "export",
      exported.ok,
      exported.ok
        ? `${statSync(exportFile).size} bytes in ${Date.now() - t0} ms`
        : firstError(exported.stdout + exported.stderr),
    )
  )
    throw new Error("stop");

  console.log("\n4. Restore into fresh, empty databases");
  const rawRun = wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    raw.config,
    "--file",
    exportFile,
  ]);
  record(
    "export imported as-is",
    "info",
    rawRun.ok
      ? "succeeded"
      : `fails: ${firstError(rawRun.stdout + rawRun.stderr)} — this is why the runbook prepares the file first`,
  );

  const prepared = prepareRestore(readFileSync(exportFile, "utf8"));
  const preparedFile = join(WORK, "export.restore.sql");
  writeFileSync(preparedFile, prepared.sql);
  const t1 = Date.now();
  const restoreRun = wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    restored.config,
    "--file",
    preparedFile,
  ]);
  if (
    !check(
      "prepared export imported into a fresh database",
      restoreRun.ok,
      restoreRun.ok
        ? `${prepared.counts.table} tables, ${prepared.counts.data} data statements, ${prepared.counts.schema} indexes/triggers in ${Date.now() - t1} ms`
        : firstError(restoreRun.stdout + restoreRun.stderr),
    )
  )
    throw new Error("stop");

  console.log("\n5. Compare the restored database with the source");
  const restoredTables = tablesOf(restored);
  check(
    "same tables",
    JSON.stringify(restoredTables) === JSON.stringify(sourceTables),
    `${restoredTables.length} of ${sourceTables.length}`,
  );
  const schemaA = schemaOf(source);
  const schemaB = schemaOf(restored);
  const kinds = (list: string[], type: string) =>
    list.filter((s) => s.startsWith(`["${type}"`)).length;
  check(
    "same schema objects (tables, indexes, triggers, SQL text)",
    JSON.stringify(schemaA) === JSON.stringify(schemaB),
    `${kinds(schemaB, "table")} tables, ${kinds(schemaB, "index")} indexes, ${kinds(schemaB, "trigger")} triggers`,
  );
  const after = fingerprint(restored, sourceTables);
  const different = [...before]
    .filter(([t, v]) => after.get(t)?.sha256 !== v.sha256 || after.get(t)?.rows !== v.rows)
    .map(([t]) => t);
  check(
    "same rows in every table (count + SHA-256)",
    different.length === 0,
    different.length
      ? `differ: ${different.join(", ")}`
      : `${before.size} tables incl. sqlite_sequence, ${[...after.values()].reduce((n, t) => n + t.rows, 0)} rows`,
  );
  const migrations = wrangler([
    "d1",
    "migrations",
    "list",
    "DB",
    "--local",
    "--config",
    restored.config,
  ]);
  check(
    "migrations recorded as applied",
    migrations.ok && /No migrations to apply/i.test(migrations.stdout),
    migrations.ok
      ? /No migrations to apply/i.test(migrations.stdout)
        ? "no migrations to apply"
        : "pending migrations listed"
      : firstError(migrations.stdout + migrations.stderr),
  );
  const quick = query(restored, "PRAGMA quick_check")[0]?.[0]?.quick_check;
  check("PRAGMA quick_check", quick === "ok", String(quick));
  const fk = query(restored, "PRAGMA foreign_key_check")[0] ?? [];
  check("PRAGMA foreign_key_check", fk.length === 0, `${fk.length} violations`);
  record(
    "PRAGMA integrity_check",
    "info",
    "not permitted by D1 (SQLITE_AUTH); quick_check is used instead",
  );
  for (const [sql, message] of [
    ["UPDATE audit_logs SET summary = summary", "audit_logs is append-only"],
    ["DELETE FROM security_events", "security_events rows are retained for 1 year"],
    ["DELETE FROM user_roles", "cannot remove the last active owner"],
  ] as const) {
    const text = refused(restored, sql);
    check(
      `trigger still protects: ${message}`,
      text?.includes(message) ?? false,
      text ? "refused as expected" : "NOT refused",
    );
  }

  console.log("\n6. The app on the restored database");
  await startApp(restored);
  try {
    const health = await fetch(`${BASE}/api/health`);
    check("health", health.ok, `status ${health.status}`);
    const setup = await new Browser().go("/setup");
    check(
      "/setup stays closed (the Owner was restored)",
      setup.status === 404,
      `status ${setup.status}`,
    );
    const owner = new Browser();
    const pwd = await owner.follow("/login", { email: OWNER.email, password, next: "/admin" });
    const recovery = await owner.follow("/login/recovery", { code: recoveryCode, next: "/admin" });
    check(
      "Owner signs in: password + recovery code issued before the export",
      pwd.path.startsWith("/login/verify") &&
        recovery.path === "/admin" &&
        recovery.res.status === 200,
      `landed on ${recovery.path} (${recovery.res.status})`,
    );
    const list = await owner.go("/admin/enquiries");
    const html = await list.text();
    check(
      "the enquiry is listed in the admin workspace",
      list.status === 200 && reference !== "" && html.includes(reference),
      `status ${list.status}`,
    );
  } finally {
    await stopApp();
  }

  const failed = results.filter((r) => r.outcome === "FAIL");
  console.log(
    `\n${failed.length === 0 ? "REHEARSAL PASSED" : "REHEARSAL FAILED"} — ${results.filter((r) => r.outcome === "PASS").length} passed, ${failed.length} failed, ${results.filter((r) => r.outcome === "INFO").length} informational; ${Math.round((Date.now() - started) / 1000)} s.`,
  );
  if (!keep) rmSync(WORK, { recursive: true, force: true });
  else console.log(`Kept ${relative(ROOT, WORK)}/ (throwaway local data; delete it when done).`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  await stopApp();
  if (!(error instanceof Error && error.message === "stop"))
    console.error(`\nRehearsal aborted: ${error instanceof Error ? error.message : String(error)}`);
  console.log(
    `\nREHEARSAL FAILED — ${results.filter((r) => r.outcome === "FAIL").length} failed step(s).`,
  );
  process.exit(1);
});
