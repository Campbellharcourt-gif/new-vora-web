import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createLogger, jsonLineSink, setLogSink } from "~/.server/observability/logger";
import { BackgroundTasks } from "../../server/platform/background";
import { isLoopbackUrl, readPlatformConfig } from "../../server/platform/config";
import { MemoryMailbox } from "../../server/platform/mailbox";
import { createLimiters, LIMITS, SlidingWindowLimiter } from "../../server/platform/rate-limiter";
import { JobScheduler } from "../../server/platform/scheduler";
import { StaticFiles } from "../../server/platform/static";

/**
 * Railway migration R1/R4 (§4.5–4.7, §8, §13.2 items 5–8): the in-process replacements for what
 * Workers provided — the rate limiter, background work, the scheduler, the log format and static
 * files — plus the platform configuration's local defaults.
 */

describe("rate limiter (Workers Rate Limiting, in-process)", () => {
  it("has exactly the binding configuration's limits: 20 / 6 / 120 / 12 per 60 s", () => {
    expect(LIMITS).toEqual({
      RL_AUTH: { limit: 20, periodMs: 60_000 },
      RL_FORMS: { limit: 6, periodMs: 60_000 },
      RL_API: { limit: 120, periodMs: 60_000 },
      RL_AI: { limit: 12, periodMs: 60_000 },
    });
    const set = createLimiters();
    expect(Object.keys(set).sort()).toEqual(["RL_AI", "RL_API", "RL_AUTH", "RL_FORMS"]);
  });

  it("allows `limit` requests per key per window, then refuses; keys are independent", async () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowLimiter({ limit: 6, periodMs: 60_000, now: () => now });
    for (let i = 0; i < 6; i += 1)
      expect(await limiter.limit({ key: "forms:ip-a" })).toEqual({ success: true });
    expect(await limiter.limit({ key: "forms:ip-a" })).toEqual({ success: false });
    expect(await limiter.limit({ key: "forms:ip-b" })).toEqual({ success: true });
    now += 30_000;
    expect(limiter.take("forms:ip-a")).toBe(false); // still inside the window
    now += 30_001;
    expect(limiter.take("forms:ip-a")).toBe(true); // the window slid past the first hits
  });

  it("is a true sliding window: never more than `limit` in any 60 s span", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter({ limit: 3, periodMs: 60_000, now: () => now });
    const accepted: number[] = [];
    for (now = 0; now < 300_000; now += 7_000) if (limiter.take("k")) accepted.push(now);
    for (const t of accepted) {
      expect(accepted.filter((u) => u > t - 60_000 && u <= t).length).toBeLessThanOrEqual(3);
    }
  });

  it("keeps memory bounded: least-recently-used keys are dropped and idle keys swept", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter({
      limit: 5,
      periodMs: 60_000,
      maxKeys: 100,
      now: () => now,
    });
    for (let i = 0; i < 1_000; i += 1) limiter.take(`ip-${i}`);
    expect(limiter.size).toBe(100);
    now += 61_000;
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });
});

describe("background tasks (waitUntil)", () => {
  it("tracks work after the response, logs failures and never throws into the request", async () => {
    const errors: unknown[] = [];
    const tasks = new BackgroundTasks((e) => errors.push(e));
    const ctx = tasks.context();
    let done = false;
    ctx.waitUntil(
      new Promise((resolve) =>
        setTimeout(() => {
          done = true;
          resolve(undefined);
        }, 30),
      ),
    );
    ctx.waitUntil(Promise.reject(new Error("send failed")));
    expect(tasks.size).toBe(2);
    expect(await tasks.drain(1_000)).toBe(true);
    expect(done).toBe(true);
    expect(errors).toHaveLength(1);
    expect(ctx.props).toEqual({});
  });

  it("drain waits for work queued while draining, and gives up at the deadline", async () => {
    const tasks = new BackgroundTasks();
    tasks.track(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          tasks.track(new Promise((r) => setTimeout(r, 30)));
          resolve();
        }, 20),
      ),
    );
    expect(await tasks.drain(1_000)).toBe(true);
    expect(tasks.size).toBe(0);
    tasks.track(new Promise(() => {})); // never settles
    expect(await tasks.drain(50)).toBe(false);
  });
});

describe("scheduler (Cron Triggers, in-process)", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  it("computes the next firings in UTC", () => {
    const scheduler = new JobScheduler(["*/5 * * * *", "17 3 * * *"], async () => {}, log);
    const from = new Date("2026-09-29T01:02:03Z");
    expect(scheduler.nextRun("*/5 * * * *", from)).toBe("2026-09-29T01:05:00.000Z");
    expect(scheduler.nextRun("17 3 * * *", from)).toBe("2026-09-29T03:17:00.000Z");
    expect(scheduler.nextRun("17 3 * * *", new Date("2026-09-29T04:00:00Z"))).toBe(
      "2026-09-30T03:17:00.000Z",
    );
  });

  it("refuses an invalid schedule at start-up, not at run time", () => {
    expect(() => new JobScheduler(["61 * * * *"], async () => {}, log)).toThrow();
  });

  it("fires each schedule with its own cron string, and never overlaps a running job", async () => {
    const calls: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const scheduler = new JobScheduler(
      ["*/5 * * * *", "17 3 * * *"],
      async (controller) => {
        calls.push(controller.cron);
        // Only the first daily run is held open, to overlap it.
        if (controller.cron === "17 3 * * *" && calls.length === 2) await held;
      },
      log,
    );
    await scheduler.fire("*/5 * * * *", Date.now());
    const daily = scheduler.fire("17 3 * * *", Date.now());
    expect(scheduler.isRunning("17 3 * * *")).toBe(true);
    void scheduler.fire("17 3 * * *", Date.now()); // overlapping firing: skipped
    expect(log.warn).toHaveBeenCalledWith("job_skipped_overlap", { cron: "17 3 * * *" });
    release();
    await daily;
    expect(calls).toEqual(["*/5 * * * *", "17 3 * * *"]);
    await scheduler.fire("17 3 * * *", Date.now()); // runs again once the first has finished
    expect(calls).toHaveLength(3);
  });

  it("a failing run is logged, never thrown; stop() waits for runs in flight", async () => {
    const scheduler = new JobScheduler(
      ["*/5 * * * *"],
      async () => {
        await new Promise((r) => setTimeout(r, 40));
        throw new Error("boom");
      },
      log,
    );
    const run = scheduler.fire("*/5 * * * *", Date.now());
    expect(await scheduler.stop(1_000)).toBe(true);
    await run;
    expect(log.error).toHaveBeenCalledWith(
      "scheduled_run_failed",
      expect.objectContaining({ error: "boom" }),
    );
    await scheduler.fire("*/5 * * * *", Date.now()); // after stop: no-op
  });
});

describe("logging for Railway: one line of JSON per entry", () => {
  it("writes exactly one newline-terminated JSON line with level and message, redacted", () => {
    const writes: [string, string][] = [];
    setLogSink(jsonLineSink((stream, text) => writes.push([stream, text])));
    try {
      const log = createLogger({ requestId: "req-1" }, "info");
      log.info("request", { status: 200, password: "hunter2" });
      log.error("page_render_failed", { errorMessage: "Bearer abcdef123456 rejected" });
      log.debug("hidden");
    } finally {
      setLogSink(null);
    }
    expect(writes).toHaveLength(2);
    for (const [, text] of writes) {
      expect(text.endsWith("\n")).toBe(true);
      expect(text.slice(0, -1)).not.toContain("\n");
    }
    const [info, error] = writes.map(([stream, text]) => ({ stream, line: JSON.parse(text) }));
    expect(info).toMatchObject({
      stream: "stdout",
      line: {
        level: "info",
        msg: "request",
        message: "request",
        requestId: "req-1",
        password: "[redacted]",
      },
    });
    expect(error?.stream).toBe("stderr");
    expect(JSON.stringify(error?.line)).not.toContain("abcdef123456");
  });

  it("an unserialisable field cannot lose the entry, and `message` cannot be overwritten", () => {
    const writes: string[] = [];
    setLogSink(jsonLineSink((_s, text) => writes.push(text)));
    try {
      createLogger({}, "info").info("job_ok", {
        count: 10n as unknown as number,
        message: "spoofed",
      });
    } finally {
      setLogSink(null);
    }
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] as string)).toMatchObject({ level: "info", message: "job_ok" });
  });
});

describe("static files (build/client)", () => {
  const root = mkdtempSync(join(tmpdir(), "vora-static-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(root, ".vite"), { recursive: true });
  writeFileSync(join(root, "assets", "entry-abc123.js"), "console.log(1)");
  writeFileSync(join(root, "assets", "entry-abc123.js.map"), "{}");
  writeFileSync(join(root, ".vite", "manifest.json"), "{}");
  writeFileSync(join(root, "favicon.svg"), "<svg/>");
  const files = new StaticFiles(root);
  const get = (path: string, init?: RequestInit) =>
    files.respond(new Request(`http://x${path}`, init), new URL(`http://x${path}`).pathname);

  it("serves hashed assets immutable for a year, other files briefly, all with nosniff", async () => {
    const asset = get("/assets/entry-abc123.js");
    expect(asset?.status).toBe(200);
    expect(asset?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(asset?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await asset?.text()).toBe("console.log(1)");
    const svg = get("/favicon.svg");
    expect(svg?.headers.get("cache-control")).toMatch(/max-age=300/);
    expect(svg?.headers.get("content-type")).toBe("image/svg+xml");
  });

  it("HEAD and conditional requests", () => {
    const head = get("/assets/entry-abc123.js", { method: "HEAD" });
    expect(head?.status).toBe(200);
    expect(head?.body).toBeNull();
    const etag = head?.headers.get("etag") ?? "";
    expect(get("/assets/entry-abc123.js", { headers: { "if-none-match": etag } })?.status).toBe(
      304,
    );
  });

  it("never serves source maps, dotfiles, traversal paths or non-GET requests", () => {
    for (const path of [
      "/assets/entry-abc123.js.map",
      "/.vite/manifest.json",
      "/../package.json",
      "/assets/%2e%2e/%2e%2e/package.json",
      "/nope.js",
    ]) {
      expect(get(path), path).toBeNull();
    }
    expect(get("/assets/entry-abc123.js", { method: "POST" })).toBeNull();
  });
});

describe("platform configuration (local defaults)", () => {
  it("development needs nothing but APP_ENV; the database defaults to a local file", () => {
    const config = readPlatformConfig({ APP_ENV: "development" }, { databasePath: ".vora/dev.db" });
    expect(config).toMatchObject({
      productionLike: false,
      originAuthSecret: null,
      access: null,
      r2: null,
      port: 3000,
    });
    expect(config.databasePath.endsWith(".vora/dev.db")).toBe(true);
  });

  it("refuses a missing APP_ENV everywhere (no silent development default in an image)", () => {
    expect(() => readPlatformConfig({}, { databasePath: "x.db" })).toThrow(/APP_ENV/);
  });

  it("refuses half an Access configuration and incomplete R2 credentials", () => {
    expect(() =>
      readPlatformConfig({ APP_ENV: "development", CF_ACCESS_AUD: "x" }, { databasePath: "x" }),
    ).toThrow(/CF_ACCESS/);
    expect(() =>
      readPlatformConfig({ APP_ENV: "development", R2_ACCOUNT_ID: "a" }, { databasePath: "x" }),
    ).toThrow(/R2_ACCESS_KEY_ID/);
  });

  it("recognises loopback endpoints only", () => {
    expect(isLoopbackUrl("http://127.0.0.1:9000")).toBe(true);
    expect(isLoopbackUrl("http://localhost:9000")).toBe(true);
    expect(isLoopbackUrl("https://127.0.0.1")).toBe(false);
    expect(isLoopbackUrl("http://10.0.0.1")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("dev mailbox (the KV-shaped capture store)", () => {
  it("lists keys in order, expires entries and stays bounded", async () => {
    let now = 0;
    const mailbox = new MemoryMailbox(3, () => now);
    await mailbox.put("mail:2", "b", { expirationTtl: 120 });
    await mailbox.put("mail:1", "a", { expirationTtl: 60 });
    expect((await mailbox.list({ prefix: "mail:" })).keys.map((k) => k.name)).toEqual([
      "mail:1",
      "mail:2",
    ]);
    now += 61_000;
    expect(await mailbox.get("mail:1")).toBeNull();
    expect(await mailbox.get("mail:2")).toBe("b");
    for (let i = 3; i < 10; i += 1) await mailbox.put(`mail:${i}`, "x");
    expect((await mailbox.list()).keys).toHaveLength(3);
  });
});
