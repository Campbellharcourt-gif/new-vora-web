import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { argon2SelfTest } from "~/.server/auth/password";
import { getConfig } from "~/.server/config/env";
import { JOB_SCHEDULES, runScheduled } from "~/.server/jobs/scheduled";
import { createKernel } from "~/.server/kernel/app";
import { createLogger, jsonLineSink, setLogSink } from "~/.server/observability/logger";
import type { AppModule } from "../../server/app";
import { type RunningServer, StartupError, startServer } from "../../server/runtime";

/**
 * Railway migration R1/R7 (§4.2, §4.7, §13.2 items 6 and 10): the real Node server — start-up
 * checks, the HTTP socket, request trust, graceful shutdown and restart — with the production
 * kernel and a stub page renderer (no React Router build). The container-level versions of these
 * checks (the real image, SIGTERM from `docker stop`, a persistent volume) are in
 * scripts/docker-rehearsal.ts.
 */

const work = mkdtempSync(join(tmpdir(), "vora-lifecycle-"));
const running: RunningServer[] = [];
afterEach(async () => {
  while (running.length) await running.pop()?.shutdown("test");
  setLogSink(null);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

let seq = 0;
const dbPath = () => join(work, `db-${++seq}`, "vora.db");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const probe = { backgroundDone: false, slowStarted: false };

/** The application module, with a stub renderer and two test routes for draining. */
function appModule(): AppModule {
  const kernel = createKernel({
    renderPage: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/slow") {
        probe.slowStarted = true;
        await delay(300);
        return new Response("slow done", { headers: { "Content-Type": "text/plain" } });
      }
      if (path === "/hang") await new Promise(() => {});
      return new Response(`<!doctype html><title>page</title><p>${request.url}</p>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });
  const withBackground = {
    fetch: (request: Request, env: never, ctx: ExecutionContext) => {
      if (new URL(request.url).pathname === "/slow")
        ctx.waitUntil(delay(400).then(() => (probe.backgroundDone = true)));
      return kernel.fetch(request, env, ctx);
    },
  };
  return {
    argon2SelfTest,
    getConfig,
    JOB_SCHEDULES,
    runScheduled,
    createLogger,
    jsonLineSink,
    setLogSink,
    createAppKernel: () => withBackground,
  } as unknown as AppModule;
}

const baseVars = {
  APP_ENV: "development",
  APP_ORIGIN: "http://localhost:5173",
  AUTH_SECRET: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  EMAIL_TRANSPORT: "capture",
  PORT: "0",
  HOST: "127.0.0.1",
  LOG_LEVEL: "error",
  SCHEDULER: "off",
};

async function start(
  vars: Record<string, string>,
  extra: Partial<Parameters<typeof startServer>[0]> = {},
) {
  const lines: string[] = [];
  const server = await startServer({
    logWrite: (_stream, text) => lines.push(text),
    vars: { ...baseVars, ...vars },
    app: appModule(),
    staticRoot: null,
    migrationsDir: resolve("migrations"),
    defaultDatabasePath: dbPath(),
    handleSignals: false,
    exitOnShutdown: false,
    ...extra,
  });
  running.push(server);
  return { server, lines };
}

const productionVars = (path: string) => ({
  APP_ENV: "production",
  APP_ORIGIN: "https://vorawebsites.store",
  DATABASE_PATH: path,
  ORIGIN_AUTH_SECRET: "o".repeat(40),
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "r".repeat(20),
  TURNSTILE_SITE_KEY: "lifecycle-site-key",
  TURNSTILE_SECRET_KEY: "t".repeat(24),
  R2_ACCOUNT_ID: "lifecycle",
  R2_BUCKET_MEDIA: "m",
  R2_BUCKET_PRIVATE: "p",
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
  R2_ENDPOINT: "http://127.0.0.1:9",
});

describe("start-up refuses unsafe configuration (fail closed)", () => {
  it("production without ORIGIN_AUTH_SECRET, with a short one, or without an application secret", async () => {
    for (const vars of [
      { ...productionVars(dbPath()), ORIGIN_AUTH_SECRET: "" },
      { ...productionVars(dbPath()), ORIGIN_AUTH_SECRET: "short" },
      { ...productionVars(dbPath()), TURNSTILE_SECRET_KEY: "" },
      { ...productionVars(dbPath()), APP_ORIGIN: "http://vorawebsites.store" },
    ]) {
      const error = await start(vars).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).step).toBe("configuration");
    }
  });

  it("a failing migration stops start-up and leaves a pre-migration snapshot", async () => {
    const path = dbPath();
    const first = await start({ DATABASE_PATH: path });
    await first.server.shutdown("test");
    running.pop();
    const dir = join(work, "bad-migrations");
    cpSync(resolve("migrations"), dir, { recursive: true });
    writeFileSync(join(dir, "0003_bad.sql"), "INSERT INTO no_such_table VALUES (1);\n");
    const error = await start({ DATABASE_PATH: path }, { migrationsDir: dir }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StartupError);
    expect((error as StartupError).step).toBe("migrations");
    expect(readdirSync(join(path, "..")).some((f) => f.startsWith("pre-migrate-"))).toBe(true);
  });
});

describe("serving", () => {
  it("development: live health over the real socket, migrations applied at start-up", async () => {
    const { server } = await start({ DATABASE_PATH: dbPath() });
    const res = await fetch(`${server.url}/api/health/live`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "live",
      database: "ok",
      migrations: "complete",
      foreignKeys: "on",
    });
    expect(server.env.DEV_MAILBOX).toBeDefined();
  });

  it("production: refuses anything without the origin-auth header; serves the rest with the public URL", async () => {
    const vars = productionVars(dbPath());
    const { server } = await start(vars);
    expect(server.env.DEV_MAILBOX).toBeUndefined();
    const direct = await fetch(`${server.url}/`);
    expect(direct.status).toBe(403);
    const ok = await fetch(`${server.url}/work?x=1`, {
      headers: { "x-vora-origin-auth": vars.ORIGIN_AUTH_SECRET, host: "evil.example" },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("strict-transport-security")).toMatch(/max-age=63072000/);
    expect(await ok.text()).toContain("https://vorawebsites.store/work?x=1");
    const live = await fetch(`${server.url}/api/health/live`);
    expect(live.status).toBe(200); // Railway's deploy check: exempt, and reveals states only
  });
});

describe("graceful shutdown (SIGTERM) and restart", () => {
  it("drains an in-flight request and its background work, then closes the database", async () => {
    probe.backgroundDone = false;
    probe.slowStarted = false;
    const { server } = await start({ DATABASE_PATH: dbPath() });
    const inFlight = fetch(`${server.url}/slow`).then(
      async (r) => [r.status, await r.text()] as const,
    );
    while (!probe.slowStarted) await delay(5);
    const result = await server.shutdown("SIGTERM");
    running.pop();
    expect(await inFlight).toEqual([200, "slow done"]);
    expect(probe.backgroundDone).toBe(true);
    expect(result.clean).toBe(true);
    await expect(fetch(`${server.url}/api/health/live`)).rejects.toThrow(); // no longer listening
  });

  it("a request that never finishes cannot hold shutdown past its deadline", async () => {
    const { server } = await start({ DATABASE_PATH: dbPath(), SHUTDOWN_TIMEOUT_MS: "1000" });
    void fetch(`${server.url}/hang`).catch(() => {});
    await delay(100);
    const started = Date.now();
    const result = await server.shutdown("SIGTERM");
    running.pop();
    expect(result.clean).toBe(false);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("restarts on the same file: data kept, no migration re-run", async () => {
    const path = dbPath();
    const first = await start({ DATABASE_PATH: path });
    await first.server.env.DB.prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('restart.marker', '1', 1)",
    ).run();
    await first.server.shutdown("SIGTERM");
    running.pop();
    const second = await start({ DATABASE_PATH: path });
    expect(
      await second.server.env.DB.prepare(
        "SELECT count(*) AS n FROM site_settings WHERE key = 'restart.marker'",
      ).first("n"),
    ).toBe(1);
    expect(
      await second.server.env.DB.prepare("SELECT count(*) AS n FROM d1_migrations").first("n"),
    ).toBe(3);
    expect(existsSync(path)).toBe(true);
  });
});

describe("scheduler inside the server", () => {
  it("a five-minute firing runs the email job and records it", async () => {
    const { server } = await start({ DATABASE_PATH: dbPath() });
    await server.scheduler.fire("*/5 * * * *", Date.now());
    const run = await server.env.DB.prepare(
      "SELECT job, status FROM job_runs ORDER BY started_at DESC LIMIT 1",
    ).first<{ job: string; status: string }>();
    expect(run).toEqual({ job: "email-retry", status: "ok" });
  });
});
