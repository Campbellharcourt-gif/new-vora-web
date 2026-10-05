/**
 * LOCAL ONLY — rehearses docs/runbooks/backup-and-recovery.md end to end on throwaway files
 * (Railway migration §6.9, R7; CP-2.1 · A2 restated). It never contacts Railway, Cloudflare or
 * R2: the Litestream replica is a local directory (docker/litestream.file.yml), and `--remote` /
 * `--env` are refused.
 *
 *   npm run db:restore-rehearsal                       # needs `litestream` (v0.5) on PATH, or LITESTREAM_BIN
 *   npm run db:restore-rehearsal -- --keep             # keep .vora/restore-rehearsal/
 *   npm run db:restore-rehearsal -- --without-litestream   # snapshot path only (reported as such)
 *
 *  1. source     — a fresh database file: migrations (by the server at start-up) + base seed.
 *  2. activity   — the production build (build/server/index.js) running as Litestream's child
 *                  (`litestream replicate -exec`, exactly as in the container): the first Owner
 *                  via /setup, a public enquiry, a failed and a successful Owner sign-in (password +
 *                  emailed code). Real rows in the auth, audit, security and enquiry tables.
 *  3. backups    — layer 1: the Litestream replica written continuously during the activity;
 *                  layer 3: a `VACUUM INTO` snapshot (what the server writes before migrations).
 *  4. restore    — `litestream restore` into a FRESH file; the snapshot copied to another.
 *  5. compare    — each restored copy against the source: tables, schema objects and their SQL,
 *                  per-table row counts + SHA-256 of all rows, sqlite_sequence, migrations,
 *                  quick_check, integrity_check, foreign_key_check, foreign keys enforced, and the
 *                  protective triggers still firing.
 *  6. app        — the production build on the RESTORED (Litestream) database: live health,
 *                  /setup stays closed, the Owner signs in with password + a recovery code issued
 *                  before the backup, and the enquiry is listed in the admin workspace.
 *
 * Prints no secrets, codes, passwords or row contents — only names, counts, digests and results.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { LOCAL_DEFAULTS, readVarsFile } from "../server/local-env";
import { applyBaseSeed } from "../server/ops";
import {
  integrityCheck,
  openDatabase,
  readPragmas,
  type SqliteDatabase,
} from "../server/platform/sqlite";

const ROOT = process.cwd();
const WORK = resolve(ROOT, ".vora/restore-rehearsal");
const PORT = 5190;
const BASE = `http://localhost:${PORT}`;
const OWNER = { name: "Rehearsal Owner", email: "owner.rehearsal@vora.test" };

const args = process.argv.slice(2);
if (args.includes("--remote") || args.some((a) => a.startsWith("--env"))) {
  console.error("The restore rehearsal is local-only. It never takes --remote or --env.");
  process.exit(2);
}
const keep = args.includes("--keep");
const withoutLitestream = args.includes("--without-litestream");

function findLitestream(): string | null {
  const candidates = [process.env.LITESTREAM_BIN, "litestream"].filter(Boolean) as string[];
  for (const bin of candidates) {
    const run = spawnSync(bin, ["version"], { encoding: "utf8" });
    if (run.status === 0 && /^v?0\.5\./.test(run.stdout.trim())) return bin;
  }
  return null;
}

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
// Database inspection (libSQL, read-only use)

async function rowsOf(db: SqliteDatabase, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.prepare(sql).all()).results;
}

async function tablesOf(db: SqliteDatabase): Promise<string[]> {
  return (
    await rowsOf(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY name",
    )
  ).map((r) => String(r.name));
}

async function schemaOf(db: SqliteDatabase): Promise<string[]> {
  return (
    await rowsOf(
      db,
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name",
    )
  ).map((r) => JSON.stringify([r.type, r.name, r.tbl_name, r.sql]));
}

/** Row count and SHA-256 over every row of every table (order-independent). */
async function fingerprint(db: SqliteDatabase, tables: string[]) {
  const out = new Map<string, { rows: number; sha256: string }>();
  for (const name of [...tables, "sqlite_sequence"]) {
    const rows = (await rowsOf(db, `SELECT * FROM "${name.replaceAll('"', '""')}"`))
      .map((row) =>
        JSON.stringify(
          Object.entries(row).map(([k, v]) => [
            k,
            v instanceof ArrayBuffer ? Buffer.from(v).toString("hex") : v,
          ]),
        ),
      )
      .sort();
    out.set(name, {
      rows: rows.length,
      sha256: createHash("sha256").update(rows.join("\n")).digest("hex"),
    });
  }
  return out;
}

async function refused(db: SqliteDatabase, sql: string): Promise<string | null> {
  try {
    await db.prepare(sql).run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------------------------------------------------------------------------------------------
// The production build, on one database at a time

let server: ChildProcess | null = null;

function appEnv(databasePath: string, secrets: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...LOCAL_DEFAULTS,
    ...secrets,
    APP_ORIGIN: BASE,
    HOST: "localhost",
    PORT: String(PORT),
    DATABASE_PATH: databasePath,
    LOG_LEVEL: "warn",
    SCHEDULER: "off",
  };
}

async function startApp(
  label: string,
  databasePath: string,
  secrets: Record<string, string>,
  litestream: { bin: string; replica: string } | null,
): Promise<void> {
  const log = openSync(join(WORK, `app-${label}.log`), "w");
  const node = `${process.execPath} --enable-source-maps build/server/index.js`;
  const env = appEnv(databasePath, secrets);
  server = litestream
    ? spawn(litestream.bin, ["replicate", "-config", "docker/litestream.file.yml", "-exec", node], {
        cwd: ROOT,
        env: { ...env, LITESTREAM_FILE_REPLICA: litestream.replica },
        stdio: ["ignore", log, log],
      })
    : spawn(process.execPath, ["--enable-source-maps", "build/server/index.js"], {
        cwd: ROOT,
        env,
        stdio: ["ignore", log, log],
      });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`The app exited early (see ${relative(ROOT, WORK)}/app-${label}.log).`);
    try {
      if ((await fetch(`${BASE}/api/health/live`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("The app did not become healthy within 60 s.");
}

async function stopApp(): Promise<number | null> {
  const child = server;
  server = null;
  if (!child || child.exitCode !== null) return child?.exitCode ?? null;
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  child.kill("SIGTERM");
  return Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 30_000))]);
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

async function compare(
  label: string,
  source: {
    tables: string[];
    schema: string[];
    before: Map<string, { rows: number; sha256: string }>;
  },
  path: string,
) {
  const db = await openDatabase({ path });
  try {
    const tables = await tablesOf(db);
    check(
      `${label}: same tables`,
      JSON.stringify(tables) === JSON.stringify(source.tables),
      `${tables.length} of ${source.tables.length}`,
    );
    const schema = await schemaOf(db);
    const kinds = (list: string[], type: string) =>
      list.filter((s) => s.startsWith(`["${type}"`)).length;
    check(
      `${label}: same schema objects (tables, indexes, triggers, SQL text)`,
      JSON.stringify(schema) === JSON.stringify(source.schema),
      `${kinds(schema, "table")} tables, ${kinds(schema, "index")} indexes, ${kinds(schema, "trigger")} triggers`,
    );
    const after = await fingerprint(db, source.tables);
    const different = [...source.before]
      .filter(([t, v]) => after.get(t)?.sha256 !== v.sha256 || after.get(t)?.rows !== v.rows)
      .map(([t]) => t);
    check(
      `${label}: same rows in every table (count + SHA-256)`,
      different.length === 0,
      different.length
        ? `differ: ${different.join(", ")}`
        : `${source.before.size} tables incl. sqlite_sequence, ${[...after.values()].reduce((n, t) => n + t.rows, 0)} rows`,
    );
    const migrations = (await rowsOf(db, "SELECT name FROM d1_migrations ORDER BY id")).map((r) =>
      String(r.name),
    );
    check(
      `${label}: every migration recorded as applied`,
      migrations.length === readdirSync("migrations").filter((f) => f.endsWith(".sql")).length,
      migrations.join(", "),
    );
    const integrity = await integrityCheck(db);
    check(`${label}: PRAGMA quick_check`, integrity.quickCheck === "ok", integrity.quickCheck);
    const full = String((await db.client.execute("PRAGMA integrity_check")).rows[0]?.[0]);
    check(`${label}: PRAGMA integrity_check`, full === "ok", full);
    check(
      `${label}: PRAGMA foreign_key_check`,
      integrity.foreignKeyViolations === 0,
      `${integrity.foreignKeyViolations} violations`,
    );
    const pragmas = await readPragmas(db);
    check(
      `${label}: foreign keys enforced`,
      pragmas.foreignKeys === 1,
      `foreign_keys=${pragmas.foreignKeys}`,
    );
    for (const [sql, message] of [
      ["UPDATE audit_logs SET summary = summary", "audit_logs is append-only"],
      ["DELETE FROM security_events", "security_events rows are retained for 1 year"],
      ["DELETE FROM user_roles", "cannot remove the last active owner"],
    ] as const) {
      const text = await refused(db, sql);
      check(
        `${label}: trigger still protects — ${message}`,
        text?.includes(message) ?? false,
        text ? "refused as expected" : "NOT refused",
      );
    }
  } finally {
    db.close();
  }
}

async function main() {
  const started = Date.now();
  console.log("Restore rehearsal (LOCAL ONLY — nothing is sent to Railway, Cloudflare or R2)\n");
  const litestream = withoutLitestream ? null : findLitestream();
  if (!withoutLitestream && !litestream) {
    console.error(
      "Litestream 0.5.x not found. Install it (macOS: `brew install litestream`) or set LITESTREAM_BIN;\n" +
        "or run with --without-litestream to rehearse the snapshot path only.",
    );
    process.exit(1);
  }
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const sourcePath = join(WORK, "source", "vora.db");
  const replica = join(WORK, "replica");
  const restoredPath = join(WORK, "restored-litestream", "vora.db");
  const snapshotPath = join(WORK, "restored-snapshot", "vora.db");

  console.log("1. Build and source database");
  execFileSync("npx", ["react-router", "build"], { cwd: ROOT, stdio: "ignore" });
  execFileSync(process.execPath, ["scripts/e2e-secrets.mjs"], { cwd: ROOT, stdio: "ignore" });
  const secrets = readVarsFile(join(ROOT, "build", "server", ".dev.vars"));
  record("build", true, "local production build with throwaway secrets (build/server/.dev.vars)");

  console.log(
    `\n2. Activity through the production build${litestream ? " under `litestream replicate -exec`" : ""}`,
  );
  const password = `Rh-${randomBytes(9).toString("base64url")}-9`;
  let recoveryCode = "";
  let reference = "";
  await startApp("source", sourcePath, secrets, litestream ? { bin: litestream, replica } : null);
  try {
    record("source migrations", true, "applied by the server at start-up");
    const seedDb = await openDatabase({ path: sourcePath });
    try {
      await applyBaseSeed(seedDb);
    } finally {
      seedDb.close();
    }
    record("source seed", true, "base seed applied while the server runs (a second writer)");

    const owner = new Browser();
    const setup = await owner.go("/setup", {
      setupToken: secrets.SETUP_TOKEN ?? "",
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
    const code = await stopApp();
    check("clean shutdown on SIGTERM", code === 0, `exit code ${code}`);
  }

  // The source as it is after a clean shutdown.
  const sourceDb = await openDatabase({ path: sourcePath });
  const source = {
    tables: await tablesOf(sourceDb),
    schema: await schemaOf(sourceDb),
    before: new Map<string, { rows: number; sha256: string }>(),
  };
  source.before = await fingerprint(sourceDb, source.tables);
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
  const empty = needRows.filter((t) => (source.before.get(t)?.rows ?? 0) === 0);
  check(
    "source has real rows to restore",
    empty.length === 0,
    empty.length
      ? `empty: ${empty.join(", ")}`
      : `${needRows.length} key tables populated; ${source.tables.length} tables, ${[...source.before.values()].reduce((n, t) => n + t.rows, 0)} rows in total`,
  );

  console.log("\n3–4. Backups and restores into fresh files");
  mkdirSync(join(WORK, "restored-snapshot"), { recursive: true });
  await sourceDb.client.execute({ sql: "VACUUM INTO ?", args: [snapshotPath] });
  sourceDb.close();
  record("snapshot (VACUUM INTO)", true, "consistent single-file copy written");

  if (litestream) {
    mkdirSync(join(WORK, "restored-litestream"), { recursive: true });
    const t0 = Date.now();
    const restore = spawnSync(
      litestream,
      ["restore", "-config", "docker/litestream.file.yml", "-o", restoredPath, sourcePath],
      {
        cwd: ROOT,
        env: { ...process.env, DATABASE_PATH: sourcePath, LITESTREAM_FILE_REPLICA: replica },
        encoding: "utf8",
      },
    );
    if (
      !check(
        "litestream restore into a fresh file",
        restore.status === 0 && existsSync(restoredPath),
        restore.status === 0
          ? `restored in ${Date.now() - t0} ms`
          : ((restore.stderr || restore.stdout).trim().split("\n").at(-1) ?? "failed"),
      )
    )
      throw new Error("stop");
  } else {
    record("litestream restore", "info", "NOT RUN (--without-litestream)");
    mkdirSync(join(WORK, "restored-litestream"), { recursive: true });
    copyFileSync(snapshotPath, restoredPath);
  }

  console.log("\n5. Compare with the source");
  if (litestream) await compare("litestream", source, restoredPath);
  await compare("snapshot", source, snapshotPath);

  console.log("\n6. The app on the restored database");
  await startApp("restored", restoredPath, secrets, null);
  try {
    const live = await fetch(`${BASE}/api/health/live`);
    check("live health on the restored database", live.ok, `status ${live.status}`);
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
      "Owner signs in: password + recovery code issued before the backup",
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
