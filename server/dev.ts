import { createServer as createViteServer } from "vite";
import type { AppModule } from "./app";
import { LOCAL_DEFAULTS, readVarsFile } from "./local-env";
import { startServer } from "./runtime";

/**
 * Development server (Railway migration §4.3): the same Node server as production, with Vite in
 * middleware mode in front of it — React Router's documented custom-server pattern, replacing the
 * Cloudflare plugin's workerd dev runtime. Vite serves client modules and HMR; the application is
 * loaded through `ssrLoadModule`, so edits apply without a restart.
 *
 *   npm run dev            # http://localhost:5173
 *
 * Variables: LOCAL_DEFAULTS (server/local-env.ts), then `.dev.vars` (your local secrets), then the
 * process environment. The database is `.vora/dev.db` unless DATABASE_PATH says otherwise.
 */
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});

const load = () => vite.ssrLoadModule("/server/app.ts") as Promise<AppModule>;
const app = await load();
let current: { mod: AppModule; kernel: ReturnType<AppModule["createAppKernel"]> } | null = null;

const vars = { ...LOCAL_DEFAULTS, ...readVarsFile(".dev.vars"), ...process.env };
if (vars.APP_ENV === "staging" || vars.APP_ENV === "production") {
  console.error("The development server refuses APP_ENV staging/production.");
  process.exit(1);
}

try {
  await startServer({
    vars,
    app,
    kernel: async () => {
      const mod = await load();
      if (current?.mod !== mod) current = { mod, kernel: mod.createAppKernel({ devServer: true }) };
      return current.kernel;
    },
    staticRoot: null,
    middleware: vite.middlewares,
    migrationsDir: "migrations",
    defaultDatabasePath: ".vora/dev.db",
    devServer: true,
  });
} catch {
  await vite.close();
  process.exit(1);
}
