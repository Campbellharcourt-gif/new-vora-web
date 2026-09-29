import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";
import { baseSeedStatements } from "~/.server/db/seed/sql";

/** Real migrations + real base seed, once per test file (storage is isolated per file). */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const statements = baseSeedStatements(Date.now());
  // Batches are atomic; chunk to keep each batch small.
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50).map((sql) => env.DB.prepare(sql)));
  }
});
