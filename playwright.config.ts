import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the PRODUCTION BUILD running on Node (build/server/index.js), with a
 * throwaway local SQLite database (migrated, seeded, one dev user per role). Nothing here touches
 * a remote resource (Railway, Cloudflare, Resend).
 *
 *   npm run test:e2e
 *
 * PW_CHROMIUM_PATH lets environments with a preinstalled Chromium skip `playwright install`.
 *
 * Browser matrix (CP-2.1 · A4). The default run is Chromium (desktop + Pixel 7). With
 * E2E_BROWSERS=all, WebKit (the Safari engine: desktop + iPhone) and Firefox projects are added,
 * mirroring the Chromium ones. Run each engine in its own invocation — every run starts fresh
 * servers and fresh throwaway databases, which the one-time /setup flow and the per-IP rate
 * limits need:
 *
 *   npx playwright install webkit firefox        # once
 *   npm run test:e2e:browsers                    # WebKit run, then Firefox run
 */
const chromiumPath = process.env.PW_CHROMIUM_PATH || undefined;
const chromium = {
  channel: undefined,
  launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
};
const allBrowsers = process.env.E2E_BROWSERS === "all";
const MOBILE_SPECS = /(smoke|a11y)\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1, // one shared local database and per-IP rate limits: keep runs deterministic
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...chromium } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...chromium }, testMatch: MOBILE_SPECS },
    ...(allBrowsers
      ? [
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
          { name: "mobile-webkit", use: { ...devices["iPhone 14"] }, testMatch: MOBILE_SPECS },
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        ]
      : []),
  ],
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
