import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TURNSTILE_TEST_SITE_KEYS } from "@shared/turnstile";
import { afterAll, describe, expect, it } from "vitest";
import { checkDeployConfig, type DeployEnv, REQUIRED_SECRETS } from "../../scripts/predeploy-check";

/** CP-2.1 · H2 — the pre-upload check that runs inside `npm run deploy:<env>`. */

const UUID = "11111111-2222-4333-8444-555555555555";
// Shaped like a real site key; assembled so this file never contains one.
const SITE_KEY = `0x4AAAAAAA${"GoodSiteKey123"}`;

const userConfig = {
  env: {
    staging: {
      name: "vora-web-staging",
      routes: [{ pattern: "staging.vorawebsites.store", custom_domain: true }],
    },
    production: { name: "vora-web" },
  },
};

/** A correct build output, shaped like build/server/wrangler.json for the environment. */
function good(env: DeployEnv): Record<string, unknown> {
  const staging = env === "staging";
  return {
    name: staging ? "vora-web-staging" : "vora-web",
    targetEnvironment: env,
    topLevelName: "vora-web-local",
    routes: staging ? [{ pattern: "staging.vorawebsites.store", custom_domain: true }] : null,
    workers_dev: false,
    preview_urls: false,
    vars: {
      APP_ENV: env,
      APP_ORIGIN: staging ? "https://staging.vorawebsites.store" : "https://vorawebsites.store",
      APP_NAME: "VORA",
      EMAIL_TRANSPORT: "resend",
      EMAIL_FROM: "VORA <hello@vorawebsites.store>",
      TURNSTILE_SITE_KEY: SITE_KEY,
      AI_GATEWAY_BASE_URL: "",
      MAINTENANCE_MODE: "off",
      LOG_LEVEL: "info",
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: staging ? "vora-staging" : "vora-production",
        database_id: UUID,
      },
    ],
    r2_buckets: [{ binding: "MEDIA", bucket_name: staging ? "vora-media-staging" : "vora-media" }],
    kv_namespaces: [],
    ratelimits: [{ name: "RL_AUTH", namespace_id: "4201", simple: { limit: 20, period: 60 } }],
    secrets: { required: [...REQUIRED_SECRETS] },
    // Wrangler's own dev-server settings live in the generated file too; they are not deployed.
    dev: { ip: "localhost", local_protocol: "http" },
  };
}

function problemsFor(env: DeployEnv, patch: (b: Record<string, unknown>) => void): string[] {
  const built = structuredClone(good(env));
  patch(built);
  return checkDeployConfig(built, userConfig, env).map((p) => `${p.field}: ${p.rule}`);
}
const vars = (b: Record<string, unknown>) => b.vars as Record<string, string>;
const firstDb = (b: Record<string, unknown>) =>
  (b.d1_databases as { database_id: string }[])[0] as { database_id: string };

describe("checkDeployConfig", () => {
  it("accepts a correct staging and production build", () => {
    expect(checkDeployConfig(good("staging"), userConfig, "staging")).toEqual([]);
    expect(checkDeployConfig(good("production"), userConfig, "production")).toEqual([]);
  });

  it("rejects the local development build and a build for the other environment", () => {
    const local = problemsFor("staging", (b) => {
      b.targetEnvironment = null;
      b.name = "vora-web-local";
    });
    expect(local.join("\n")).toMatch(/targetEnvironment: this is the LOCAL development build/);
    expect(local.join("\n")).toMatch(/name: expected the staging Worker "vora-web-staging"/);
    const crossed = checkDeployConfig(good("production"), userConfig, "staging").map(
      (p) => p.field,
    );
    expect(crossed).toEqual(
      expect.arrayContaining(["targetEnvironment", "name", "routes", "vars.APP_ENV"]),
    );
  });

  it("rejects placeholders and non-UUID database IDs", () => {
    const result = problemsFor("staging", (b) => {
      firstDb(b).database_id = "REPLACE_WITH_STAGING_D1_ID";
      vars(b).TURNSTILE_SITE_KEY = "REPLACE_WITH_STAGING_TURNSTILE_SITE_KEY";
    });
    expect(result).toEqual(
      expect.arrayContaining([
        "d1_databases[0].database_id: still a REPLACE_WITH_… placeholder",
        "vars.TURNSTILE_SITE_KEY: still a REPLACE_WITH_… placeholder",
        "d1_databases[0].database_id: must be the real database UUID from `wrangler d1 create`",
      ]),
    );
    expect(
      problemsFor("production", (b) => {
        firstDb(b).database_id = "vora-local";
      }),
    ).toEqual([
      "d1_databases[0].database_id: must be the real database UUID from `wrangler d1 create`",
    ]);
  });

  it("rejects localhost, loopback and plain-http values", () => {
    const result = problemsFor("staging", (b) => {
      vars(b).APP_ORIGIN = "http://localhost:5173";
      vars(b).AI_GATEWAY_BASE_URL = "http://127.0.0.1:8787";
    });
    expect(result).toEqual(
      expect.arrayContaining([
        "vars.APP_ORIGIN: contains a localhost / loopback / plain-http value",
        "vars.AI_GATEWAY_BASE_URL: contains a localhost / loopback / plain-http value",
        "vars.APP_ORIGIN: must be an https:// origin",
      ]),
    );
  });

  it("rejects the dev mailbox and any other KV namespace", () => {
    const result = problemsFor("production", (b) => {
      b.kv_namespaces = [
        { binding: "DEV_MAILBOX", id: "vora-dev-mailbox" },
        { binding: "SESSIONS_KV", id: "abc" },
      ];
    });
    expect(result).toEqual([
      "kv_namespaces[0]: the DEV_MAILBOX dev mailbox must never be deployed",
      'kv_namespaces[1]: unexpected KV binding "SESSIONS_KV" (staging/production use no KV)',
    ]);
  });

  it("rejects development settings", () => {
    const result = problemsFor("staging", (b) => {
      vars(b).EMAIL_TRANSPORT = "capture";
      vars(b).LOG_LEVEL = "debug";
      b.workers_dev = true;
      delete b.preview_urls;
    });
    expect(result).toEqual(
      expect.arrayContaining([
        'vars.EMAIL_TRANSPORT: must be "resend"',
        "vars.LOG_LEVEL: debug logging is not allowed",
        "workers_dev: must be false",
        "preview_urls: must be false",
      ]),
    );
  });

  it("rejects every Cloudflare Turnstile test site key (H1 at deploy time)", () => {
    for (const key of TURNSTILE_TEST_SITE_KEYS) {
      expect(
        problemsFor("production", (b) => {
          vars(b).TURNSTILE_SITE_KEY = key;
        }),
        key,
      ).toEqual([
        "vars.TURNSTILE_SITE_KEY: is a Cloudflare Turnstile TEST key (always passes/fails)",
      ]);
    }
  });

  it("requires exactly the declared secrets, and never a secret as a plain var", () => {
    expect(
      problemsFor("staging", (b) => {
        delete b.secrets;
      }),
    ).toEqual([
      "secrets.required: must list exactly AUTH_SECRET, RESEND_API_KEY, TURNSTILE_SECRET_KEY",
    ]);
    expect(
      problemsFor("staging", (b) => {
        b.secrets = { required: ["AUTH_SECRET", "SETUP_TOKEN"] };
      }),
    ).toHaveLength(1);
    expect(
      problemsFor("staging", (b) => {
        vars(b).SETUP_TOKEN = "x";
      }),
    ).toEqual(["vars.SETUP_TOKEN: secrets must never be plain vars"]);
  });

  it("refuses www routes and routes that differ from wrangler.jsonc", () => {
    const result = problemsFor("production", (b) => {
      b.routes = [{ pattern: "www.vorawebsites.store", custom_domain: true }];
    });
    expect(result).toEqual([
      "routes: do not match wrangler.jsonc env.production.routes",
      "routes[0]: www must be a Redirect Rule to the apex, never a Worker route",
    ]);
  });

  it("reports fields and rules only, never the values", () => {
    const text = JSON.stringify(
      checkDeployConfig(
        {
          ...good("staging"),
          vars: { ...vars(good("staging")), TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEYS[0] },
        },
        userConfig,
        "staging",
      ),
    );
    expect(text).not.toContain(TURNSTILE_TEST_SITE_KEYS[0]);
    expect(text).not.toContain(UUID);
  });
});

describe("predeploy-check command line", () => {
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const script = join(process.cwd(), "scripts", "predeploy-check.ts");
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function project(built: Record<string, unknown> | null): string {
    const dir = mkdtempSync(join(tmpdir(), "vora-predeploy-"));
    dirs.push(dir);
    // wrangler.jsonc with comments, exactly like the real one.
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      `// comment\n${JSON.stringify(userConfig, null, 2)}\n`,
    );
    if (built) {
      mkdirSync(join(dir, "build", "server"), { recursive: true });
      writeFileSync(join(dir, "build", "server", "wrangler.json"), JSON.stringify(built));
    }
    return dir;
  }
  const run = (dir: string, args: string[]) =>
    spawnSync(tsx, [script, ...args], { cwd: dir, encoding: "utf8", timeout: 60_000 });

  it("passes a correct build", () => {
    const result = run(project(good("staging")), ["--env", "staging"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Pre-deploy check (staging): OK");
  });

  it("fails before upload on the current placeholders, listing each field", () => {
    const built = good("staging");
    firstDb(built).database_id = "REPLACE_WITH_STAGING_D1_ID";
    vars(built).TURNSTILE_SITE_KEY = "REPLACE_WITH_STAGING_TURNSTILE_SITE_KEY";
    const result = run(project(built), ["--env", "staging"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAILED — nothing was uploaded");
    expect(result.stderr).toContain(
      "d1_databases[0].database_id: still a REPLACE_WITH_… placeholder",
    );
    expect(result.stderr).toContain("vars.TURNSTILE_SITE_KEY: still a REPLACE_WITH_… placeholder");
  });

  it("fails when there is no build, and on bad usage", () => {
    expect(run(project(null), ["--env", "production"]).status).toBe(1);
    expect(run(project(good("staging")), []).status).toBe(2);
    expect(run(project(good("staging")), ["--env", "local"]).status).toBe(2);
  });
});
