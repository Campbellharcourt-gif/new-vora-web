// E2E only: serves the SAME production build (build/server/index.js) from three Node servers,
// each on its own throwaway SQLite file (Railway migration §13.1):
//   :5175  .wrangler/e2e-setup-nojs-state  no users — the /setup flow without JavaScript
//   :5174  .wrangler/e2e-setup-state       no users — the /setup flow in a normal browser
//   :5173  .wrangler/e2e-state             migrated, seeded, one dev user per role (main suite)
// Variables: the local defaults (APP_ENV=development, capture mail, the Turnstile test key) plus
// the throwaway secrets in build/server/.dev.vars; APP_ORIGIN is each server's own address. The
// :5173 server — the one Playwright waits for — starts last, so once it answers, all are ready.
// Stops all when any exits or when Playwright stops the web server.
import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { LOCAL_DEFAULTS, readVarsFile } from "../server/local-env";

const servers = [
  { port: "5175", state: ".wrangler/e2e-setup-nojs-state" },
  { port: "5174", state: ".wrangler/e2e-setup-state" },
  { port: "5173", state: ".wrangler/e2e-state" },
];

const secrets = readVarsFile("build/server/.dev.vars");
const children: ChildProcess[] = [];
let stopping = false;

function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1_500).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop(0));

async function healthy(port: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health/live`);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

for (const { port, state } of servers) {
  const child = spawn(process.execPath, ["--enable-source-maps", "build/server/index.js"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...LOCAL_DEFAULTS,
      ...secrets,
      APP_ORIGIN: `http://localhost:${port}`,
      HOST: "localhost",
      PORT: port,
      DATABASE_PATH: resolve(state, "vora.db"),
      LOG_LEVEL: "warn",
    },
  });
  children.push(child);
  child.on("exit", (code) => stop(code ?? 1));
  if (!(await healthy(port))) {
    console.error(`E2E: the server on :${port} did not become healthy.`);
    stop(1);
    break;
  }
}
