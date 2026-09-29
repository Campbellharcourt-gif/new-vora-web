// E2E only (CP-2.1 · A3, restated for Railway): the production build in PRODUCTION MODE behind a
// local stand-in for Cloudflare, at https://localhost:8443, with a throwaway database.
//
//   browser ──HTTPS──▶ this proxy (self-signed certificate, like Cloudflare's edge TLS)
//                        adds X-Vora-Origin-Auth (the Transform Rule) and CF-Connecting-IP
//                      ──HTTP──▶ node build/server/index.js  (APP_ENV=production, :8444)
//                                  R2 → a local in-memory S3 mock (loopback only)
//
// So the suite exercises the real production trust path: origin authentication is enforced, the
// public URL comes from APP_ORIGIN, and Secure/__Host- cookies, HSTS and the other production-only
// behaviour are real. All secrets are random and throwaway; email is disabled; the Turnstile keys
// are random non-test values (production refuses Cloudflare's test keys, H1). Nothing here
// contacts Cloudflare, Resend or R2.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { resolve } from "node:path";
import { applyBaseSeed } from "../server/ops";
import { createDevUsers } from "./lib/dev-users";
import { openLocalDatabase } from "./lib/local-db";
import { startS3Mock } from "./lib/s3-mock";

const STATE = ".wrangler/https-state";
const PUBLIC_PORT = 8443;
const APP_PORT = 8444;
const ORIGIN_SECRET = randomBytes(32).toString("base64url");

rmSync(STATE, { recursive: true, force: true });
mkdirSync(STATE, { recursive: true });

// Throwaway database with the base seed and one user per role (`*.https@vora.test`).
const db = await openLocalDatabase(`${STATE}/vora.db`);
try {
  await applyBaseSeed(db);
  const users = await createDevUsers(db, "https");
  writeFileSync(`${STATE}/users.json`, JSON.stringify(users.credentials, null, 2), { mode: 0o600 });
} finally {
  db.close();
}

// A self-signed certificate for localhost (development only; the browser test ignores it).
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${STATE}/key.pem`,
    "-out",
    `${STATE}/cert.pem`,
    "-days",
    "2",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);

execFileSync("npx", ["react-router", "build"], { stdio: ["ignore", "ignore", "inherit"] });
const s3 = await startS3Mock();

const random = (bytes: number) => randomBytes(bytes).toString("hex");
const app: ChildProcess = spawn(
  process.execPath,
  ["--enable-source-maps", "build/server/index.js"],
  {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      TZ: "UTC",
      APP_ENV: "production",
      APP_ORIGIN: `https://localhost:${PUBLIC_PORT}`,
      HOST: "127.0.0.1",
      PORT: String(APP_PORT),
      DATABASE_PATH: resolve(STATE, "vora.db"),
      ORIGIN_AUTH_SECRET: ORIGIN_SECRET,
      EMAIL_TRANSPORT: "disabled",
      LOG_LEVEL: "warn",
      TURNSTILE_SITE_KEY: `rehearsal-${random(12)}`,
      TURNSTILE_SECRET_KEY: `rehearsal-${random(16)}`,
      AUTH_SECRET: randomBytes(48).toString("base64url"),
      R2_ACCOUNT_ID: "local-rehearsal",
      R2_BUCKET_MEDIA: "vora-media-local",
      R2_BUCKET_PRIVATE: "vora-private-local",
      R2_ACCESS_KEY_ID: random(10),
      R2_SECRET_ACCESS_KEY: random(20),
      R2_ENDPOINT: s3.endpoint,
      SCHEDULER: "off",
    },
  },
);

// The Cloudflare stand-in: terminate TLS, add the origin-auth header and the client IP, forward.
const proxy = createServer(
  { key: readFileSync(`${STATE}/key.pem`), cert: readFileSync(`${STATE}/cert.pem`) },
  (req, res) => {
    const headers = { ...req.headers };
    delete headers["x-vora-origin-auth"];
    headers["x-vora-origin-auth"] = ORIGIN_SECRET;
    headers["cf-connecting-ip"] = (req.socket.remoteAddress ?? "127.0.0.1").replace(/^::ffff:/, "");
    headers["cf-ray"] = `${random(8)}-SYD`;
    const upstream = httpRequest(
      { host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  },
);
proxy.listen(PUBLIC_PORT, "localhost", () => {
  console.log(`HTTPS production-mode server: https://localhost:${PUBLIC_PORT} (state in ${STATE})`);
});

function stop() {
  proxy.close();
  void s3.close();
  if (app.exitCode === null) app.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1_500).unref();
}
app.on("exit", (code) => {
  proxy.close();
  void s3.close();
  process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
