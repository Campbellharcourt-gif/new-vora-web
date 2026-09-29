/**
 * `npm run deploy:check` (Railway migration §13.3, H2 restated): build → security scan → this.
 * It builds the production image exactly as Railway will (the root Dockerfile) and asks the image
 * itself to validate each environment's template with throwaway values — then proves it refuses to
 * start without a required secret. It deploys NOTHING and contacts no Railway, Cloudflare or R2
 * account. Deploying is a separate, approved step (docs/runbooks/deployment.md).
 *
 *   npm run deploy:check
 *   BUILD_CA_FILE=/path/ca.pem npm run deploy:check     # only behind a TLS-intercepting proxy
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const TAG = "vora-web:deploy-check";
const problems: string[] = [];
const say = (line: string) => process.stdout.write(`${line}\n`);

if (!existsSync("build/server/index.js")) {
  console.error("No build — run `npm run build` first (deploy:check does).");
  process.exit(1);
}
if (spawnSync("docker", ["info"], { encoding: "utf8" }).status !== 0) {
  console.error(
    "Docker is not available: the image check is NOT VERIFIED. Start Docker and re-run.",
  );
  process.exit(1);
}

const buildArgs = ["build", "-t", TAG, "."];
if (process.env.BUILD_CA_FILE) {
  // Behind a TLS-intercepting proxy: the proxy's CA as a build secret (never in a layer), host
  // networking and the proxy settings, as that network requires.
  buildArgs.splice(
    1,
    0,
    "--secret",
    `id=build_ca,src=${process.env.BUILD_CA_FILE}`,
    "--network",
    "host",
  );
  for (const name of ["HTTPS_PROXY", "HTTP_PROXY"] as const)
    if (process.env[name]) buildArgs.splice(1, 0, "--build-arg", `${name}=${process.env[name]}`);
}
say(`Building ${TAG} from the root Dockerfile…`);
const build = spawnSync("docker", buildArgs, { stdio: "inherit" });
if (build.status !== 0) process.exit(1);

function throwaway(name: string): Record<string, string> {
  const vars = parseEnv(readFileSync(`config/railway.${name}.env.example`, "utf8")) as Record<
    string,
    string
  >;
  return {
    ...vars,
    AUTH_SECRET: randomBytes(48).toString("base64url"),
    RESEND_API_KEY: `re_${randomBytes(12).toString("hex")}`,
    TURNSTILE_SITE_KEY: `check-${randomBytes(8).toString("hex")}`,
    TURNSTILE_SECRET_KEY: `check-${randomBytes(12).toString("hex")}`,
    ORIGIN_AUTH_SECRET: randomBytes(32).toString("base64url"),
    R2_ACCOUNT_ID: randomBytes(16).toString("hex"),
    R2_ACCESS_KEY_ID: randomBytes(16).toString("hex"),
    R2_SECRET_ACCESS_KEY: randomBytes(32).toString("hex"),
    ...(name === "staging"
      ? {
          CF_ACCESS_TEAM_DOMAIN: "check.cloudflareaccess.com",
          CF_ACCESS_AUD: randomBytes(32).toString("hex"),
        }
      : {}),
  };
}

function check(vars: Record<string, string>): number {
  const env = Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // `--entrypoint node`: validation only — no Litestream, no volume, no network.
  const run = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "node",
      ...env,
      TAG,
      "build/server/index.js",
      "check",
    ],
    { encoding: "utf8" },
  );
  return run.status ?? 1;
}

for (const name of ["staging", "production"] as const) {
  const vars = throwaway(name);
  const ok = check(vars) === 0;
  say(`${ok ? "PASS" : "FAIL"}  ${name}: the image accepts the template with real-shaped values`);
  if (!ok) problems.push(`${name}: valid configuration refused`);
  const refused = check({ ...vars, ORIGIN_AUTH_SECRET: "" }) !== 0;
  say(
    `${refused ? "PASS" : "FAIL"}  ${name}: the image refuses to start without ORIGIN_AUTH_SECRET`,
  );
  if (!refused) problems.push(`${name}: missing secret accepted`);
}

if (problems.length) {
  console.error(`\ndeploy:check FAILED — ${problems.join("; ")}`);
  process.exit(1);
}
say("\ndeploy:check passed. Nothing was deployed.");
