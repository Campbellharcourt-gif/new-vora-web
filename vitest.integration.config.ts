import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { LOCAL_DEFAULTS } from "./server/local-env.ts";

/**
 * Integration tests run in Node against the REAL platform adapters (Railway migration §13.1):
 * SQLite through libSQL (`:memory:`, foreign keys on), in-memory object storage, the in-process
 * rate limiters and the dev mailbox. `cloudflare:test` / `cloudflare:workers` are aliased to
 * tests/support/node-runtime.ts, so the test files are unchanged from the workerd suite. Every
 * test file gets its own database; migrations and base seed data are applied in the setup file.
 *
 * The variables are the local defaults (what wrangler.jsonc's top level gave workerd) overridden
 * by the values the workerd suite passed through Miniflare.
 */
const INTEGRATION_VARS: Record<string, string> = {
  ...LOCAL_DEFAULTS,
  APP_ENV: "test",
  APP_ORIGIN: "http://localhost:5173",
  EMAIL_TRANSPORT: "capture",
  AUTH_SECRET: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  AUTH_SECRET_PREVIOUS: "",
  TURNSTILE_SECRET_KEY: "",
  GEMINI_API_KEY: "",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
  SETUP_TOKEN: "setup-token-for-tests-0123456789",
  MAINTENANCE_MODE: "off",
  LOG_LEVEL: "error",
};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "cloudflare:test": resolve(import.meta.dirname, "tests/support/node-runtime.ts"),
      "cloudflare:workers": resolve(import.meta.dirname, "tests/support/node-runtime.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    env: INTEGRATION_VARS,
    setupFiles: ["./tests/support/setup-integration.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each file gets a fresh module graph — and so its own database, limiters and mailbox.
    isolate: true,
    // A test that makes no assertion fails instead of passing silently.
    expect: { requireAssertions: true },
  },
});
