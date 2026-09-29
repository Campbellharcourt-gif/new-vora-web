import { defineConfig, devices } from "@playwright/test";

/**
 * CP-2.1 · A3 — PRODUCTION MODE over HTTPS, locally. The production build runs in workerd via
 * `wrangler dev --local-protocol https` (self-signed certificate) with APP_ENV=production, an
 * https APP_ORIGIN and a throwaway local database (scripts/https-server.mjs). It checks what the
 * plain-http suite cannot: Secure `__Host-` session cookies, HSTS, the upgrade-insecure-requests
 * CSP, production indexing headers and the absence of development-only endpoints. Nothing here
 * touches Cloudflare.
 *
 *   npm run test:e2e:https                     # Chromium
 *   E2E_BROWSERS=all npm run test:e2e:https    # + WebKit (Safari engine) and Firefox
 */
const chromiumPath = process.env.PW_CHROMIUM_PATH || undefined;
const allBrowsers = process.env.E2E_BROWSERS === "all";

export default defineConfig({
  testDir: "./tests/e2e-https",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "https://localhost:8443",
    ignoreHTTPSErrors: true, // wrangler's self-signed development certificate
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "https-chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
    ...(allBrowsers
      ? [
          { name: "https-webkit", use: { ...devices["Desktop Safari"] } },
          { name: "https-firefox", use: { ...devices["Desktop Firefox"] } },
        ]
      : []),
  ],
  webServer: {
    command: "node scripts/https-server.mjs",
    url: "https://localhost:8443/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
