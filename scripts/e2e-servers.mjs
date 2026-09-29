// E2E only: serves the SAME production build from three `vite preview` servers, each with its own
// throwaway local state (CP-2.1 · A1):
//   :5175  .wrangler/e2e-setup-nojs-state  no users — the /setup flow without JavaScript
//   :5174  .wrangler/e2e-setup-state       no users — the /setup flow in a normal browser
//   :5173  .wrangler/e2e-state             migrated, seeded, one dev user per role (main suite)
// They start one after the other: each picks the first free debugger (inspector) port, so starting
// them at once races for the same port. The :5173 server — the one Playwright waits for — starts
// last, so once it answers, all are ready. Stops all when any exits or when Playwright stops the
// web server.
import { spawn } from "node:child_process";

const servers = [
  { port: "5175", state: ".wrangler/e2e-setup-nojs-state" },
  { port: "5174", state: ".wrangler/e2e-setup-state" },
  { port: "5173", state: ".wrangler/e2e-state" },
];

const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(0));

async function healthy(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

for (const { port, state } of servers) {
  const child = spawn("npx", ["vite", "preview", "--port", port, "--strictPort"], {
    stdio: "inherit",
    env: { ...process.env, VORA_LOCAL_STATE: state },
  });
  children.push(child);
  child.on("exit", (code) => stop(code ?? 1));
  if (!(await healthy(port))) {
    console.error(`E2E: the preview server on :${port} did not become healthy.`);
    stop(1);
    break;
  }
}
