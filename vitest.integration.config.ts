import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * Integration tests run INSIDE workerd (the real Workers runtime) with Miniflare-backed D1, R2,
 * KV and rate limiters from wrangler.jsonc. Every test file gets isolated storage; migrations and
 * base seed data are applied in the setup file.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        // The test worker wraps the real kernel with a stub page renderer (no React Router build).
        main: "./tests/support/test-worker.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
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
          },
        },
      };
    }),
  ],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/support/setup-integration.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // A test that makes no assertion fails instead of passing silently.
    expect: { requireAssertions: true },
  },
});
