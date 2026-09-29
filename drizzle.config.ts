import { defineConfig } from "drizzle-kit";

/**
 * Drizzle generates SQL migrations from the schema; Wrangler applies them to D1
 * (`npm run db:migrate:*`). Generated SQL is reviewed and committed before it is applied.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./app/.server/db/schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
