// E2E only (CP-2.1 · A3): serves the production build in PRODUCTION MODE over HTTPS at
// https://localhost:8443, with a throwaway local database, so Secure/__Host- cookies, HSTS and the
// other production-only behaviour can be tested locally. Used by `npm run test:e2e:https`.
//
// The Worker code is the same build as everywhere else; production mode comes from the variables
// below (APP_ENV=production and an https APP_ORIGIN), loaded with `wrangler dev --env-file`
// (which also means build/server/.dev.vars is NOT loaded). All secrets are random and throwaway.
// The Turnstile keys are random non-test values: production mode refuses Cloudflare's test keys
// (H1), and no test here reaches a Turnstile-protected step. Email is disabled. Nothing here
// contacts Cloudflare: wrangler dev runs locally (workerd) with a self-signed certificate, and
// its download of request metadata (workers.cloudflare.com/cf.json) is switched off.
// `--upstream-protocol https` makes the Worker see https:// request URLs, as in production.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const STATE = ".wrangler/https-state";
const ENV_FILE = `${STATE}/production-mode.env`;
const PORT = "8443";

const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_SEND_ERROR_REPORTS: "false",
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
};
delete env.CLOUDFLARE_ENV; // always the local build and local bindings

const quiet = (command, args) =>
  execFileSync(command, args, { env, stdio: ["ignore", "ignore", "inherit"] });

rmSync(STATE, { recursive: true, force: true });
mkdirSync(STATE, { recursive: true });
quiet("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", STATE]);
quiet("npx", ["tsx", "scripts/seed.ts", "--local", "--persist-to", STATE]);
// Prints the throwaway passwords once; they are only needed from users.json.
quiet("npx", [
  "tsx",
  "scripts/dev-users.ts",
  "--persist-to",
  STATE,
  "--set",
  "https",
  "--out",
  `${STATE}/users.json`,
]);
quiet("npx", ["react-router", "build"]);

const random = (bytes) => randomBytes(bytes).toString("hex");
writeFileSync(
  ENV_FILE,
  [
    "APP_ENV=production",
    `APP_ORIGIN=https://localhost:${PORT}`,
    "EMAIL_TRANSPORT=disabled",
    "LOG_LEVEL=info",
    `TURNSTILE_SITE_KEY=rehearsal-${random(12)}`,
    `TURNSTILE_SECRET_KEY=rehearsal-${random(16)}`,
    `AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log(
  `HTTPS production-mode server: https://localhost:${PORT} (throwaway state in ${STATE})`,
);

const child = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--local-protocol",
    "https",
    "--upstream-protocol",
    "https",
    "--ip",
    "localhost",
    "--port",
    PORT,
    "--env-file",
    ENV_FILE,
    "--persist-to",
    STATE,
    "--show-interactive-dev-session=false",
  ],
  { env, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => {
    child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 500).unref();
  });
