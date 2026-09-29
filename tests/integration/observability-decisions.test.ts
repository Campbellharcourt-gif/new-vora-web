import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "~/.server/config/env";
import { createKernel } from "~/.server/kernel/app";
import { call, ORIGIN, testEnv } from "../support/helpers";

/**
 * CP-2.1 decisions on CP-1 observations, verified inside workerd:
 *   O-1 — the planned maintenance 503 is logged at info with `maintenance: true`; genuine 5xx stay
 *         errors (so maintenance cannot trip error alerts, and real failures still do).
 *   O-2 — credentials inside free text (error messages, stacks) are scrubbed before logging.
 */

type Line = Record<string, unknown>;
const infoEnv = (overrides: Partial<Record<keyof WorkerEnv, string>> = {}) =>
  ({ ...testEnv, LOG_LEVEL: "info", ...overrides }) as WorkerEnv;

function captureConsole() {
  const lines = { info: [] as Line[], error: [] as Line[], warn: [] as Line[] };
  vi.spyOn(console, "log").mockImplementation((line: Line) => lines.info.push(line));
  vi.spyOn(console, "warn").mockImplementation((line: Line) => lines.warn.push(line));
  vi.spyOn(console, "error").mockImplementation((line: Line) => lines.error.push(line));
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("O-1 · maintenance responses are logged as expected behaviour", () => {
  it("logs the maintenance 503 (page and API) at info with maintenance: true, never as an error", async () => {
    const lines = captureConsole();
    const env = infoEnv({ MAINTENANCE_MODE: "on" });
    const page = await call("/", { env });
    const api = await call("/api/v1/status", { env });
    expect(page.status).toBe(503);
    expect(api.status).toBe(503);

    const requests = lines.info.filter((l) => l.msg === "request");
    expect(requests.map((l) => [l.status, l.level, l.maintenance])).toEqual([
      [503, "info", true],
      [503, "info", true],
    ]);
    expect(lines.info.filter((l) => l.msg === "api_maintenance")).toHaveLength(1);
    expect(lines.error, "no error lines during planned maintenance").toEqual([]);
  });

  it("still logs a genuine server failure as an error", async () => {
    const lines = captureConsole();
    const broken = createKernel({
      renderPage: async () => {
        throw new Error("renderer exploded");
      },
    });
    const ctx = createExecutionContext();
    const res = await broken.fetch(
      new Request(`${ORIGIN}/work`, { headers: { "cf-connecting-ip": "192.0.2.10" } }),
      infoEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(500);
    const request = lines.error.find((l) => l.msg === "request");
    expect(request).toMatchObject({ level: "error", status: 500 });
    expect(request).not.toHaveProperty("maintenance");
  });
});

describe("O-2 · credentials in free text never reach the log", () => {
  it("scrubs a password embedded in an unexpected error before it is logged", async () => {
    const lines = captureConsole();
    const broken = createKernel({
      renderPage: async () => {
        throw new Error("secret stack detail: D1 password=hunter2");
      },
    });
    const ctx = createExecutionContext();
    const res = await broken.fetch(
      new Request(`${ORIGIN}/work`, { headers: { "cf-connecting-ip": "192.0.2.11" } }),
      infoEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(500);
    const logged = JSON.stringify(lines.error);
    expect(lines.error.length).toBeGreaterThan(0);
    expect(logged).not.toContain("hunter2");
    expect(logged).toContain("password=[redacted]");
  });
});
