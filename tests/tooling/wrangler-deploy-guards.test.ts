import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readJsonc } from "../../scripts/lib/jsonc";
import { type DeployEnv, REQUIRED_SECRETS } from "../../scripts/predeploy-check";
import { MOCK_REFUSAL, MockCloudflareApi, type MockScenario } from "./support/mock-cloudflare-api";

/**
 * CP-2.1 · H3 + H4, verified against the EXACT Wrangler in node_modules (package-lock.json).
 *
 * The real `wrangler deploy` runs against a local mock of the Cloudflare API: no account, no
 * token, no network (any other outbound request hits a dead proxy), and the mock refuses every
 * upload — nothing can be published. The Worker deployed is a one-line stand-in carrying exactly
 * the bindings, vars and secret declarations of wrangler.jsonc env.staging / env.production,
 * with the deploy flags taken from the real `npm run deploy:<env>` scripts.
 *
 * What stays NOT VERIFIED until a real deploy: Cloudflare's own server-side checks (a missing
 * bucket or secret is simulated here the way the API documents it).
 */

const ROOT = process.cwd();
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const FAKE_D1 = "00000000-0000-4000-8000-000000000000";
// Shaped like a real site key; assembled so this file never contains one.
const SITE_KEY = `0x4AAAAAAA${"MockSiteKey123"}`;
const DEAD_PROXY = "http://127.0.0.1:9";

type Section = Record<string, unknown> & { vars?: Record<string, string> };
const userConfig = readJsonc<Section & { env: Record<DeployEnv, Section> }>(
  join(ROOT, "wrangler.jsonc"),
);
const scripts = (
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

/** The arguments `npm run deploy:<env>` passes to `wrangler deploy`. */
function deployArgs(env: DeployEnv): string[] {
  const match = /wrangler deploy([^&]*)$/.exec(scripts[`deploy:${env}`] ?? "");
  if (!match) throw new Error(`deploy:${env} does not end with wrangler deploy`);
  return (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
}

/** A stand-in Worker with the environment's real bindings, vars, routes and secret declarations. */
function project(env: DeployEnv, dir: string) {
  const section = userConfig.env[env];
  const config = {
    name: section.name,
    main: "index.js",
    no_bundle: true,
    compatibility_date: userConfig.compatibility_date,
    compatibility_flags: userConfig.compatibility_flags,
    workers_dev: section.workers_dev,
    preview_urls: section.preview_urls,
    ...(section.routes ? { routes: section.routes } : {}),
    limits: userConfig.limits,
    observability: userConfig.observability,
    vars: { ...section.vars, TURNSTILE_SITE_KEY: SITE_KEY },
    d1_databases: (section.d1_databases as { binding: string; database_name: string }[]).map(
      (db) => ({ binding: db.binding, database_name: db.database_name, database_id: FAKE_D1 }),
    ),
    r2_buckets: section.r2_buckets,
    ratelimits: section.ratelimits,
    secrets: section.secrets,
  };
  writeFileSync(join(dir, "wrangler.json"), JSON.stringify(config, null, 2));
  writeFileSync(
    join(dir, "index.js"),
    'export default { fetch() { return new Response("ok"); } };\n',
  );
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function deploy(env: DeployEnv, scenario: MockScenario, args: string[]) {
  const api = new MockCloudflareApi(scenario);
  const baseUrl = await api.start();
  const dir = mkdtempSync(join(tmpdir(), `vora-deploy-${env}-`));
  dirs.push(dir);
  mkdirSync(join(dir, ".config"), { recursive: true });
  project(env, dir);
  try {
    // Asynchronous on purpose: the mock API lives in this process and must keep answering.
    const result = await run(WRANGLER, ["deploy", ...args], {
      cwd: dir,
      // A clean environment: never the developer's own Cloudflare login, token or CLOUDFLARE_ENV.
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dir,
        XDG_CONFIG_HOME: join(dir, ".config"),
        CLOUDFLARE_API_TOKEN: "mock-token",
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        CLOUDFLARE_API_BASE_URL: baseUrl,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_SEND_ERROR_REPORTS: "false",
        WRANGLER_LOG_PATH: join(dir, "logs"),
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        HTTPS_PROXY: DEAD_PROXY,
        HTTP_PROXY: DEAD_PROXY,
        https_proxy: DEAD_PROXY,
        http_proxy: DEAD_PROXY,
      },
    });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes
    const output = `${result.stdout}\n${result.stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
    return { status: result.status, output, api };
  } finally {
    await api.stop();
  }
}

const everything = (env: DeployEnv): MockScenario => ({
  workerExists: true,
  buckets: (userConfig.env[env].r2_buckets as { bucket_name: string }[]).map((b) => b.bucket_name),
  secrets: [...REQUIRED_SECRETS],
});

describe("wrangler deploy guards (Wrangler from package-lock.json, local mock API)", {
  timeout: 120_000,
}, () => {
  it("the deploy scripts disable automatic resource provisioning", () => {
    expect(deployArgs("staging")).toContain("--experimental-provision=false");
    expect(deployArgs("production")).toContain("--experimental-provision=false");
  });

  for (const env of ["staging", "production"] as const) {
    it(`${env}: a missing R2 bucket is never created by the deploy (H4)`, async () => {
      const { status, output, api } = await deploy(
        env,
        { ...everything(env), buckets: [] },
        deployArgs(env),
      );
      expect(api.find("POST", /\/r2\/buckets$/), "bucket create calls").toEqual([]);
      expect(api.find("GET", /\/r2\/buckets/), "provisioning lookups").toEqual([]);
      // Wrangler went on to the upload, which Cloudflare refuses for a missing bucket (mocked).
      expect(api.upload(), "upload attempted").not.toBeNull();
      expect(output).toContain(MOCK_REFUSAL);
      expect(status).not.toBe(0);
    });

    it(`${env}: a brand-new Worker is refused until its required secrets exist (H3)`, async () => {
      const { status, output, api } = await deploy(
        env,
        { workerExists: false, buckets: everything(env).buckets, secrets: [] },
        deployArgs(env),
      );
      expect(output).toContain(
        "The following required secrets have not been set: AUTH_SECRET, RESEND_API_KEY, TURNSTILE_SECRET_KEY",
      );
      expect(api.upload(), "nothing uploaded").toBeNull();
      expect(status).not.toBe(0);
    });
  }

  it("without the flag, Wrangler's default WOULD create missing buckets (why H4 exists)", async () => {
    const withoutFlag = deployArgs("staging").filter((a) => a !== "--experimental-provision=false");
    const { status, api } = await deploy(
      "staging",
      { ...everything("staging"), buckets: [] },
      withoutFlag,
    );
    const created = api.find("POST", /\/r2\/buckets$/).map((c) => JSON.parse(c.body).name);
    expect(created.sort()).toEqual(["vora-media-staging", "vora-private-staging"]);
    expect(status).not.toBe(0); // the mock still refuses the upload itself
  });

  it("staging: an existing Worker must already hold every required secret (H3)", async () => {
    const { status, output, api } = await deploy(
      "staging",
      { ...everything("staging"), secrets: ["AUTH_SECRET"] },
      deployArgs("staging"),
    );
    const inherited = (api.upload()?.bindings ?? []).filter((b) => b.type === "inherit");
    expect(inherited.map((b) => b.name).sort()).toEqual([...REQUIRED_SECRETS].sort());
    expect(output).toContain(
      "The following required secrets have not been set: RESEND_API_KEY, TURNSTILE_SECRET_KEY",
    );
    expect(status).not.toBe(0);
  });

  it("staging: with everything in place the upload carries names only, never secret values", async () => {
    const { status, output, api } = await deploy(
      "staging",
      everything("staging"),
      deployArgs("staging"),
    );
    const bindings = api.upload()?.bindings ?? [];
    const types = (type: string) =>
      bindings
        .filter((b) => b.type === type)
        .map((b) => b.name)
        .sort();
    expect(types("inherit")).toEqual([...REQUIRED_SECRETS].sort());
    expect(types("secret_text")).toEqual([]);
    expect(types("r2_bucket")).toEqual(["MEDIA", "PRIVATE"]);
    expect(types("d1")).toEqual(["DB"]);
    expect(types("ratelimit")).toEqual(["RL_AI", "RL_API", "RL_AUTH", "RL_FORMS"]);
    expect(types("kv_namespace")).toEqual([]);
    expect(api.find("POST", /\/r2\/buckets$/)).toEqual([]);
    expect(output).toContain(MOCK_REFUSAL); // and still nothing was published
    expect(status).not.toBe(0);
  });
});
