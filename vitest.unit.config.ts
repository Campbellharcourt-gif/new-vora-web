import { defineConfig } from "vitest/config";

/** Pure-logic unit tests (Node). Anything touching bindings belongs in the integration suite. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/tooling/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    // A test that makes no assertion fails instead of passing silently.
    expect: { requireAssertions: true },
  },
});
