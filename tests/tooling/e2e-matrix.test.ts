import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CP-2.1 · A4 — the E2E browser matrix. The WebKit (Safari engine) and Firefox projects must run
 * exactly the tests their Chromium counterparts run; the default run stays Chromium-only; and each
 * engine runs in its own invocation (fresh servers and databases). Checked with Playwright's own
 * test listing, which needs no browser. Running the engines themselves happens on a Mac
 * (`npm run test:e2e:browsers`) and is recorded in VERIFICATION-LOG.md.
 */

const ROOT = process.cwd();
const PLAYWRIGHT = join(ROOT, "node_modules", ".bin", "playwright");

interface Suite {
  title: string;
  specs?: { title: string; file: string; tests: { projectName: string }[] }[];
  suites?: Suite[];
}

function listTests(args: string[], env: Record<string, string>): Promise<Map<string, Set<string>>> {
  return new Promise((resolve, reject) => {
    const child = spawn(PLAYWRIGHT, ["test", "--list", "--reporter=json", ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`playwright --list exited ${code}`));
      const byProject = new Map<string, Set<string>>();
      const walk = (suite: Suite, path: string[]) => {
        for (const spec of suite.specs ?? [])
          for (const t of spec.tests) {
            const set = byProject.get(t.projectName) ?? new Set<string>();
            set.add([spec.file, ...path, spec.title].join(" › "));
            byProject.set(t.projectName, set);
          }
        for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
      };
      for (const file of (JSON.parse(out) as { suites: Suite[] }).suites) walk(file, []);
      resolve(byProject);
    });
  });
}

const sorted = (set: Set<string> | undefined) => [...(set ?? [])].sort();

describe("E2E browser matrix", { timeout: 60_000 }, () => {
  it("runs Chromium only by default (desktop + Pixel 7)", async () => {
    const projects = await listTests([], { E2E_BROWSERS: "" });
    expect([...projects.keys()].sort()).toEqual(["desktop", "mobile"]);
    expect(projects.get("desktop")?.size).toBeGreaterThan(0);
  });

  it("gives WebKit and Firefox exactly the tests of their Chromium counterparts", async () => {
    const projects = await listTests([], { E2E_BROWSERS: "all" });
    expect([...projects.keys()].sort()).toEqual([
      "desktop",
      "firefox",
      "mobile",
      "mobile-webkit",
      "webkit",
    ]);
    expect(sorted(projects.get("webkit"))).toEqual(sorted(projects.get("desktop")));
    expect(sorted(projects.get("firefox"))).toEqual(sorted(projects.get("desktop")));
    expect(sorted(projects.get("mobile-webkit"))).toEqual(sorted(projects.get("mobile")));
    // The one-time /setup flow is part of every engine's run.
    expect(sorted(projects.get("webkit")).some((t) => t.startsWith("setup.spec.ts"))).toBe(true);
  });

  it("the HTTPS production-mode suite runs the same tests in every engine", async () => {
    const projects = await listTests(["--config", "playwright.https.config.ts"], {
      E2E_BROWSERS: "all",
    });
    expect([...projects.keys()].sort()).toEqual([
      "https-chromium",
      "https-firefox",
      "https-webkit",
    ]);
    expect(sorted(projects.get("https-webkit"))).toEqual(sorted(projects.get("https-chromium")));
    expect(sorted(projects.get("https-firefox"))).toEqual(sorted(projects.get("https-chromium")));
  });

  it("runs each engine in its own invocation, and uses a preinstalled Chromium only for Chromium", async () => {
    const scripts = (
      JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    const runs = (scripts["test:e2e:browsers"] ?? "").split("&&").map((s) => s.trim());
    expect(runs).toEqual([
      "E2E_BROWSERS=all playwright test --project=webkit --project=mobile-webkit",
      "E2E_BROWSERS=all playwright test --project=firefox",
    ]);
    const config = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
    // PW_CHROMIUM_PATH must never be handed to the WebKit or Firefox launchers.
    expect(config).not.toMatch(/use:\s*\{[^}]*launchOptions[^}]*\},\s*projects/s);
    expect(config).toMatch(
      /name: "desktop", use: \{ \.\.\.devices\["Desktop Chrome"\], \.\.\.chromium \}/,
    );
  });
});
