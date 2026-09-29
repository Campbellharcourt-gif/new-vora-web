/**
 * LOCAL ONLY — the production IMAGE rehearsed end to end (Railway migration R7, §13.4). Runs the
 * image the way Railway will: APP_ENV=production, a volume at /data, the server under Litestream,
 * requests arriving with the origin-auth header Cloudflare adds. The Litestream replica is a local
 * directory (docker/litestream.file.yml) and R2 points at a dead loopback address, so nothing is
 * sent to Railway, Cloudflare or R2.
 *
 *   npm run docker:build                                   # or pass --image <tag>
 *   tsx scripts/docker-rehearsal.ts [--image vora-web:local] [--keep]
 *
 * Checks: image facts (non-root, read-only app, Node/OpenSSL/Litestream versions, no secrets or
 * public source maps) · fail-closed start-up (missing secret, missing backups, Turnstile test key)
 * · origin authentication and request trust at the real socket · security headers · static files
 * · the in-container CLI (seed, integrity) · graceful shutdown on SIGTERM (exit 0) · restart on the
 * same volume (no migration re-run, data kept) · restore on an EMPTY volume from the Litestream
 * replica (identical rows) · a failing migration stops start-up and leaves a snapshot.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chownSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../server/platform/sqlite";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const IMAGE = option("--image", "vora-web:local");
const keep = args.includes("--keep");
const PORT = 5391;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://vora.rehearsal.test";
const SECRET = randomBytes(32).toString("base64url");
const WORK = mkdtempSync(join(tmpdir(), "vora-docker-rehearsal-"));
const names: string[] = [];

type Outcome = "PASS" | "FAIL";
const results: { step: string; outcome: Outcome; detail: string }[] = [];
function check(step: string, ok: boolean, detail: string): boolean {
  results.push({ step, outcome: ok ? "PASS" : "FAIL", detail });
  console.log(`  ${(ok ? "PASS" : "FAIL").padEnd(4)}  ${step} — ${detail}`);
  return ok;
}

function docker(dockerArgs: string[], input?: string) {
  const run = spawnSync("docker", dockerArgs, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

function dir(label: string): string {
  const path = join(WORK, label);
  mkdirSync(path, { recursive: true });
  // The image runs as `node` (uid 1000); bind mounts must be writable for it.
  try {
    chownSync(path, 1000, 1000);
  } catch {
    // Docker Desktop (macOS) maps ownership itself.
  }
  return path;
}

function productionEnv(extra: Record<string, string> = {}): string[] {
  const env: Record<string, string> = {
    APP_ENV: "production",
    APP_ORIGIN: ORIGIN,
    ORIGIN_AUTH_SECRET: SECRET,
    AUTH_SECRET: randomBytes(48).toString("base64url"),
    EMAIL_TRANSPORT: "disabled",
    TURNSTILE_SITE_KEY: `rehearsal-${randomBytes(8).toString("hex")}`,
    TURNSTILE_SECRET_KEY: `rehearsal-${randomBytes(12).toString("hex")}`,
    R2_ACCOUNT_ID: "rehearsal",
    R2_BUCKET_MEDIA: "vora-media-rehearsal",
    R2_BUCKET_PRIVATE: "vora-private-rehearsal",
    R2_ACCESS_KEY_ID: randomBytes(8).toString("hex"),
    R2_SECRET_ACCESS_KEY: randomBytes(16).toString("hex"),
    R2_ENDPOINT: "http://127.0.0.1:9",
    LITESTREAM_CONFIG: "/app/docker/litestream.file.yml",
    LITESTREAM_FILE_REPLICA: "/replica",
    DATABASE_PATH: "/data/vora.db",
    SHUTDOWN_TIMEOUT_MS: "20000",
    LOG_LEVEL: "info",
    ...extra,
  };
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

function run(name: string, mounts: Record<string, string>, env: string[], extra: string[] = []) {
  names.push(name);
  docker(["rm", "-f", name]);
  const volumes = Object.entries(mounts).flatMap(([host, target]) => ["-v", `${host}:${target}`]);
  return docker([
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${PORT}:3000`,
    ...volumes,
    ...env,
    ...extra,
    IMAGE,
  ]);
}

async function waitLive(name: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = docker(["inspect", "-f", "{{.State.Running}}", name]).out.trim();
    if (state === "false") return false;
    try {
      const res = await fetch(`${BASE}/api/health/live`);
      if (res.ok) return true;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function stop(name: string): { exitCode: number; logs: string } {
  docker(["stop", "-t", "30", name]);
  const exitCode = Number(docker(["inspect", "-f", "{{.State.ExitCode}}", name]).out.trim());
  const logs = docker(["logs", name]).out;
  docker(["rm", "-f", name]);
  return { exitCode, logs };
}

function waitExit(name: string, timeoutMs = 30_000): { exitCode: number; logs: string } {
  docker(["wait", name]);
  void timeoutMs;
  const exitCode = Number(docker(["inspect", "-f", "{{.State.ExitCode}}", name]).out.trim());
  const logs = docker(["logs", name]).out;
  docker(["rm", "-f", name]);
  return { exitCode, logs };
}

const trusted = { "x-vora-origin-auth": SECRET };

async function fingerprint(path: string): Promise<Map<string, string>> {
  const db = await openDatabase({ path });
  try {
    const tables = (
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) <> 'sqlite_' AND substr(name,1,12) <> '_litestream_' ORDER BY name",
        )
        .all<{ name: string }>()
    ).results.map((r) => r.name);
    const out = new Map<string, string>();
    for (const t of tables) {
      const rows = (await db.prepare(`SELECT * FROM "${t}"`).all()).results
        .map((r) => JSON.stringify(Object.entries(r)))
        .sort();
      out.set(t, `${rows.length}:${createHash("sha256").update(rows.join("\n")).digest("hex")}`);
    }
    return out;
  } finally {
    db.close();
  }
}

async function main() {
  console.log(`Docker rehearsal of ${IMAGE} (LOCAL ONLY)\n`);
  if (docker(["image", "inspect", IMAGE]).code !== 0) {
    console.error(
      `Image ${IMAGE} not found — run \`npm run docker:build\` first (or pass --image).`,
    );
    process.exit(1);
  }

  console.log("1. Image facts");
  const id = docker(["run", "--rm", "--entrypoint", "id", IMAGE, "-u"]).out.trim();
  check("runs as a non-root user", id !== "0" && id !== "", `uid ${id}`);
  const write = docker([
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    "touch /app/x 2>/dev/null && echo writable || echo read-only",
  ]).out.trim();
  check("application directory is read-only", write === "read-only", write);
  const versions = docker([
    "run",
    "--rm",
    "--entrypoint",
    "node",
    IMAGE,
    "-e",
    "console.log(process.version, process.versions.openssl, typeof require('crypto').argon2)",
  ]).out.trim();
  check(
    "Node 24.21 with OpenSSL ≥ 3.2 and crypto.argon2",
    /^v24\.21\.0 3\.[2-9]\.\d+ function$/.test(versions),
    versions,
  );
  const ls = docker(["run", "--rm", "--entrypoint", "litestream", IMAGE, "version"]).out.trim();
  check("Litestream pinned", ls === "v0.5.17", ls);
  const files = docker([
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    "ls -a /app; ls build/client | head -50; find /app/build/client -name '*.map' | wc -l; ls /app/build/server",
  ]).out;
  check(
    "no secrets file, no public source maps, server maps kept inside",
    !/\.dev\.vars|\.env\b/.test(files) && /\n0\n/.test(files) && /index\.js\.map/.test(files),
    "build/client has 0 maps; build/server/index.js.map present; no .dev.vars/.env",
  );
  const cliCheck = docker([
    "run",
    "--rm",
    ...productionEnv(),
    IMAGE,
    "node",
    "build/server/index.js",
    "check",
  ]);
  check(
    "in-image `check` (configuration + Argon2id self-test)",
    cliCheck.code === 0,
    cliCheck.out.trim().split("\n").join(" · "),
  );

  console.log("\n2. Start-up fails closed");
  const data0 = dir("data-refusals");
  for (const [label, extra, expect] of [
    ["missing ORIGIN_AUTH_SECRET", ["-e", "ORIGIN_AUTH_SECRET="], /ORIGIN_AUTH_SECRET/],
    [
      "Cloudflare Turnstile test key",
      ["-e", "TURNSTILE_SITE_KEY=1x00000000000000000000AA"],
      /TURNSTILE_SITE_KEY/,
    ],
    [
      "no backups configured (R2 replica)",
      ["-e", "LITESTREAM_CONFIG=/app/litestream.yml", "-e", "R2_BUCKET_BACKUPS="],
      /backups_not_configured/,
    ],
  ] as const) {
    const name = `vora-rehearsal-refuse-${names.length}`;
    run(name, { [data0]: "/data" }, [...productionEnv(), ...extra]);
    const result = waitExit(name);
    check(
      `refuses to start: ${label}`,
      result.exitCode !== 0 && expect.test(result.logs),
      `exit ${result.exitCode}`,
    );
  }

  console.log("\n3. Running in production mode");
  const data = dir("data");
  const replica = dir("replica");
  run("vora-rehearsal-a", { [data]: "/data", [replica]: "/replica" }, productionEnv());
  if (
    !check(
      "starts under Litestream and reports live",
      await waitLive("vora-rehearsal-a"),
      "/api/health/live 200",
    )
  )
    throw new Error("stop");
  const direct = await fetch(`${BASE}/`);
  check(
    "direct request without the origin-auth header is refused",
    direct.status === 403,
    `status ${direct.status}`,
  );
  const forged = await fetch(`${BASE}/`, {
    headers: { "cf-connecting-ip": "203.0.113.9", "x-vora-origin-auth": "wrong" },
  });
  check(
    "forged CF-Connecting-IP with a wrong secret is refused",
    forged.status === 403,
    `status ${forged.status}`,
  );
  const home = await fetch(`${BASE}/`, {
    headers: { ...trusted, host: "evil.example", "x-forwarded-proto": "http" },
  });
  const hsts = home.headers.get("strict-transport-security");
  check(
    "trusted request served with production headers",
    home.status === 200 && hsts === "max-age=63072000; includeSubDomains; preload",
    `status ${home.status}, HSTS ${hsts ? "set" : "missing"}`,
  );
  const csp = home.headers.get("content-security-policy") ?? "";
  check(
    "CSP with nonce and upgrade-insecure-requests",
    /nonce-/.test(csp) && /upgrade-insecure-requests/.test(csp),
    "present",
  );
  const html = await home.text();
  const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0] ?? "";
  const assetRes = await fetch(`${BASE}${asset}`, { headers: trusted });
  check(
    "hashed asset immutable + nosniff",
    assetRes.ok &&
      /immutable/.test(assetRes.headers.get("cache-control") ?? "") &&
      assetRes.headers.get("x-content-type-options") === "nosniff",
    asset,
  );
  const map = await fetch(`${BASE}/index.js.map`, { headers: trusted });
  check("server source map is not public", map.status === 404, `status ${map.status}`);
  const csrfOk = await fetch(`${BASE}/api/v1/enquiries`, {
    method: "POST",
    headers: { ...trusted, origin: ORIGIN, "content-type": "application/json" },
    body: "{}",
  });
  const csrfBad = await fetch(`${BASE}/api/v1/enquiries`, {
    method: "POST",
    headers: { ...trusted, origin: BASE, "content-type": "application/json" },
    body: "{}",
  });
  const csrfBadBody = (await csrfBad.json().catch(() => ({}))) as { error?: { code?: string } };
  check(
    "CSRF: the public https Origin passes over the plain-HTTP socket; any other origin is refused",
    csrfOk.status !== 403 && csrfBad.status === 403 && csrfBadBody.error?.code === "csrf_rejected",
    `public origin → ${csrfOk.status}, socket origin → ${csrfBad.status}`,
  );
  const seed = docker(["exec", "vora-rehearsal-a", "node", "build/server/index.js", "seed"]);
  check("in-container CLI: seed", seed.code === 0, seed.out.trim().split("\n").at(-1) ?? "");
  const integrity = docker([
    "exec",
    "vora-rehearsal-a",
    "node",
    "build/server/index.js",
    "integrity",
  ]);
  check(
    "in-container CLI: integrity",
    integrity.code === 0 && /quick_check: ok/.test(integrity.out),
    integrity.out.trim().split("\n").join(" · "),
  );
  await new Promise((r) => setTimeout(r, 2_500)); // let Litestream ship the seed
  const a = stop("vora-rehearsal-a");
  check(
    "SIGTERM (docker stop): graceful shutdown, exit 0",
    a.exitCode === 0 && /"msg":"shutdown_complete"[^\n]*"clean":true/.test(a.logs),
    `exit ${a.exitCode}`,
  );
  const oneLine = a.logs
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .every((l) => {
      try {
        const parsed = JSON.parse(l) as { level?: string; message?: string };
        return typeof parsed.level === "string" && typeof parsed.message === "string";
      } catch {
        return false;
      }
    });
  check(
    "application logs are one-line JSON with level and message",
    oneLine,
    "every JSON line parsed",
  );

  console.log("\n4. Restart on the same volume");
  run("vora-rehearsal-b", { [data]: "/data", [replica]: "/replica" }, productionEnv());
  const liveB = await waitLive("vora-rehearsal-b");
  const b = stop("vora-rehearsal-b");
  check(
    "restarts on the existing database without re-applying migrations",
    liveB && /"msg":"migrations_checked"[^\n]*"applied":\[\]/.test(b.logs) && b.exitCode === 0,
    liveB ? "live; applied: []" : "did not become live",
  );

  console.log("\n5. Restore on an EMPTY volume from the Litestream replica");
  const empty = dir("data-empty");
  run("vora-rehearsal-c", { [empty]: "/data", [replica]: "/replica" }, productionEnv());
  const liveC = await waitLive("vora-rehearsal-c");
  const c = stop("vora-rehearsal-c");
  check(
    "entrypoint restores the replica, then serves",
    liveC && c.exitCode === 0,
    liveC ? "live" : "did not become live",
  );
  const before = await fingerprint(join(data, "vora.db"));
  const after = await fingerprint(join(empty, "vora.db"));
  const differ = [...before].filter(([t, v]) => after.get(t) !== v).map(([t]) => t);
  check(
    "restored rows identical to the source (count + SHA-256, every table)",
    differ.length === 0 && before.size > 50,
    differ.length ? `differ: ${differ.join(", ")}` : `${before.size} tables`,
  );

  console.log("\n6. A failing migration stops start-up and leaves a snapshot");
  const failingDir = dir("migrations-failing");
  cpSync(resolve("migrations"), failingDir, { recursive: true });
  writeFileSync(
    join(failingDir, "0003_rehearsal_failure.sql"),
    "CREATE TABLE rehearsal_ok (id integer);\n--> statement-breakpoint\nINSERT INTO no_such_table VALUES (1);\n",
  );
  run(
    "vora-rehearsal-d",
    { [data]: "/data", [replica]: "/replica", [failingDir]: "/migrations-test" },
    [...productionEnv(), "-e", "MIGRATIONS_DIR=/migrations-test"],
  );
  const d = waitExit("vora-rehearsal-d");
  const snapshots = readdirSync(data).filter((f) => /^pre-migrate-.*\.db$/.test(f));
  const stillThree =
    (await fingerprint(join(data, "vora.db"))).get("d1_migrations")?.startsWith("3:") ?? false;
  const noPartial = !(await fingerprint(join(data, "vora.db"))).has("rehearsal_ok");
  check(
    "failed migration: non-zero exit, nothing applied, pre-migration snapshot kept",
    d.exitCode !== 0 &&
      /migration_failed/.test(d.logs) &&
      snapshots.length >= 1 &&
      stillThree &&
      noPartial,
    `exit ${d.exitCode}, ${snapshots.length} snapshot(s), ledger unchanged, no partial table`,
  );

  const failed = results.filter((r) => r.outcome === "FAIL");
  console.log(
    `\n${failed.length === 0 ? "DOCKER REHEARSAL PASSED" : "DOCKER REHEARSAL FAILED"} — ${results.length - failed.length} passed, ${failed.length} failed.`,
  );
  cleanup();
  process.exit(failed.length === 0 ? 0 : 1);
}

function cleanup() {
  for (const name of names) docker(["rm", "-f", name]);
  if (!keep) rmSync(WORK, { recursive: true, force: true });
  else console.log(`Kept ${WORK}`);
}

main().catch((error) => {
  if (!(error instanceof Error && error.message === "stop"))
    console.error(`\nRehearsal aborted: ${error instanceof Error ? error.message : String(error)}`);
  cleanup();
  process.exit(1);
});
