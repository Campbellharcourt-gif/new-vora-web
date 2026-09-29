import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as app from "./app";
import { runCli } from "./cli";
import { StartupError, startServer } from "./runtime";

/**
 * Production entry (Railway migration §4.2), bundled by the Vite SSR build into
 * `build/server/index.js`. Started directly — `node --enable-source-maps build/server/index.js`,
 * never through npm, which swallows SIGTERM — under Litestream in the container.
 *
 * It never applies local development defaults: APP_ENV and everything else come from the
 * environment (sealed Railway variables for secrets), and anything missing refuses the start.
 */
const here = dirname(fileURLToPath(import.meta.url));
const paths = {
  staticRoot: process.env.CLIENT_DIR ?? resolve(here, "../client"),
  migrationsDir: process.env.MIGRATIONS_DIR ?? resolve(here, "../../migrations"),
  // Only for local runs of the production build; staging/production require DATABASE_PATH.
  defaultDatabasePath: resolve(process.cwd(), ".vora/data/vora.db"),
};

const command = process.argv[2] ?? "serve";
if (command === "serve") {
  try {
    await startServer({
      vars: process.env,
      app,
      staticRoot: paths.staticRoot,
      migrationsDir: paths.migrationsDir,
      defaultDatabasePath: paths.defaultDatabasePath,
    });
  } catch (error) {
    if (!(error instanceof StartupError)) {
      process.stderr.write(
        `${JSON.stringify({ level: "error", msg: "startup_failed", message: "startup_failed", error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    }
    // Railway's deploy health check then keeps this deploy from going live.
    process.exit(1);
  }
} else {
  process.exit(await runCli(process.argv.slice(2), app, paths));
}
