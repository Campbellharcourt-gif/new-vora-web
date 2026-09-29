/**
 * Types for the two module names the integration tests import. At run time both resolve to
 * tests/support/node-runtime.ts (vitest.integration.config.ts aliases them); nothing from
 * Cloudflare is involved.
 */
declare module "cloudflare:test" {
  export type D1Migration = import("../../server/platform/sqlite").Migration;
  export function createExecutionContext(): ExecutionContext;
  export function waitOnExecutionContext(ctx: ExecutionContext): Promise<void>;
  export function applyD1Migrations(
    db: import("../../app/.server/platform/types").SqlDatabase,
    migrations: D1Migration[],
  ): Promise<void>;
}

declare module "cloudflare:workers" {
  export const env: import("../../app/.server/config/env").WorkerEnv & {
    TEST_MIGRATIONS: import("../../server/platform/sqlite").Migration[];
  };
}
