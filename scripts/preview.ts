/**
 * The production build (build/server/index.js), run locally with the local development defaults and
 * your `.dev.vars`, on http://localhost:5173 against `.vora/dev.db`. What `vite preview` was on
 * Workers: the real server bundle, without Vite.
 *
 *   npm run preview
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { LOCAL_DEFAULTS, readVarsFile } from "../server/local-env";

const child = spawn(process.execPath, ["--enable-source-maps", "build/server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...LOCAL_DEFAULTS,
    ...readVarsFile(".dev.vars"),
    DATABASE_PATH: process.env.DATABASE_PATH ?? resolve(".vora/dev.db"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
