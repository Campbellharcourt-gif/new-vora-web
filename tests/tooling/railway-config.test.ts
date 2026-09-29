import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { isTurnstileTestKey, TURNSTILE_TEST_SITE_KEYS } from "@shared/turnstile";
import { describe, expect, it } from "vitest";
import { getConfig, type WorkerEnv } from "~/.server/config/env";
import { EMAIL_RETRY_BATCH, JOB_SCHEDULES } from "~/.server/jobs/scheduled";
import { APP_VARIABLES, readPlatformConfig } from "../../server/platform/config";

/**
 * Railway migration §13.3 — the Cloudflare deploy guards (CP-2/CP-2.1 H1–H4 and the CP-3 Free-plan
 * checks), restated for Railway. Replaces, under D23, tests/tooling/deploy-config.test.ts,
 * deploy-guards.test.ts, predeploy-check.test.ts, wrangler-deploy-guards.test.ts,
 * free-plan-config.test.ts and tests/unit/free-plan-limits.test.ts (kept intact on the CP-3
 * branch). docs/railway/TEST-MAPPING.md maps every retired case to its replacement.
 *
 * On Railway the variables live in the dashboard, so the checked-in contract is the pair of
 * templates in config/ (plain values; sealed values always empty) plus the start-up validation the
 * server runs on the real variables. Nothing is deployed by any script in this repository.
 */

const ROOT = process.cwd();
const ENVIRONMENTS = ["staging", "production"] as const;
type Name = (typeof ENVIRONMENTS)[number];

const SEALED = [
  "AUTH_SECRET",
  "AUTH_SECRET_PREVIOUS",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
  "GEMINI_API_KEY",
  "SETUP_TOKEN",
  "ORIGIN_AUTH_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;
/** Sealed values a start-up must find (the H3 list, extended for Railway). */
const REQUIRED_SEALED = [
  "AUTH_SECRET",
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "ORIGIN_AUTH_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

function template(name: Name): Record<string, string> {
  return parseEnv(
    readFileSync(join(ROOT, "config", `railway.${name}.env.example`), "utf8"),
  ) as Record<string, string>;
}

/** A template with throwaway sealed values and resource IDs filled in — what Railway would hold. */
function filled(name: Name): Record<string, string> {
  return {
    ...template(name),
    AUTH_SECRET: "a".repeat(48),
    RESEND_API_KEY: "r".repeat(20),
    TURNSTILE_SECRET_KEY: "t".repeat(24),
    TURNSTILE_SITE_KEY: "turnstile-site-key-throwaway",
    ORIGIN_AUTH_SECRET: "o".repeat(43),
    R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    R2_ACCESS_KEY_ID: "k".repeat(32),
    R2_SECRET_ACCESS_KEY: "s".repeat(64),
    ...(name === "staging"
      ? { CF_ACCESS_TEAM_DOMAIN: "vora.cloudflareaccess.com", CF_ACCESS_AUD: "a".repeat(64) }
      : {}),
  };
}

/** Everything the server checks before it listens: platform + application configuration. */
function startupProblems(vars: Record<string, string>): string[] {
  const problems: string[] = [];
  try {
    readPlatformConfig(vars, { databasePath: "/data/unused.db" });
  } catch (error) {
    problems.push(...((error as { invalidKeys?: string[] }).invalidKeys ?? [String(error)]));
  }
  try {
    getConfig({ ...vars } as unknown as WorkerEnv);
  } catch (error) {
    problems.push(
      ...((error as { internal?: { invalidKeys?: string[] } }).internal?.invalidKeys ?? [
        String(error),
      ]),
    );
  }
  return problems;
}

describe("Railway variable templates (config/railway.*.env.example)", () => {
  for (const name of ENVIRONMENTS) {
    it(`${name}: production-grade plain settings`, () => {
      const vars = template(name);
      expect(vars.APP_ENV).toBe(name);
      expect(vars.APP_ORIGIN).toMatch(/^https:\/\/[a-z.]+$/);
      expect(vars.EMAIL_TRANSPORT).toBe("resend");
      expect(vars.LOG_LEVEL).toBe("info");
      expect(vars.MAINTENANCE_MODE).toBe("off");
      expect(vars.NODE_ENV).toBe("production");
      expect(vars.TZ).toBe("UTC");
      expect(vars.RAILWAY_DEPLOYMENT_DRAINING_SECONDS).toBe("30");
      expect(vars.UV_THREADPOOL_SIZE).toBe("8");
      expect(vars.DATABASE_PATH).toMatch(/^\/data\/[a-z-]+\.db$/);
    });

    it(`${name}: every sealed value is empty — secrets are entered in Railway only`, () => {
      const vars = template(name);
      for (const key of SEALED) {
        expect(vars, key).toHaveProperty(key);
        expect(vars[key], key).toBe("");
      }
    });

    it(`${name}: no localhost, loopback, plain-http or development values`, () => {
      for (const [key, value] of Object.entries(template(name))) {
        expect(value, key).not.toMatch(/localhost|127\.0\.0\.1|::1|http:\/\//);
      }
      const vars = template(name);
      expect(vars.EMAIL_TRANSPORT).not.toBe("capture");
      expect(vars.LOG_LEVEL).not.toBe("debug");
      expect(vars).not.toHaveProperty("R2_ENDPOINT");
    });

    it(`${name}: never uses a Cloudflare Turnstile test site key (H1)`, () => {
      expect(isTurnstileTestKey(template(name).TURNSTILE_SITE_KEY)).toBe(false);
    });

    it(`${name}: the start-up validation accepts the template once real values exist`, () => {
      expect(startupProblems(filled(name))).toEqual([]);
    });

    it(`${name}: start-up refuses without each required sealed value (H3)`, () => {
      for (const key of REQUIRED_SEALED) {
        const problems = startupProblems({ ...filled(name), [key]: "" });
        expect(problems.join("; "), key).toContain(key);
      }
    });

    it(`${name}: start-up refuses a Turnstile test key, the capture transport and an http origin (H1)`, () => {
      for (const key of TURNSTILE_TEST_SITE_KEYS) {
        expect(startupProblems({ ...filled(name), TURNSTILE_SITE_KEY: key }).join(";")).toContain(
          "TURNSTILE_SITE_KEY",
        );
      }
      expect(startupProblems({ ...filled(name), EMAIL_TRANSPORT: "capture" }).join(";")).toContain(
        "EMAIL_TRANSPORT",
      );
      expect(
        startupProblems({ ...filled(name), APP_ORIGIN: "http://vorawebsites.store" }).join(";"),
      ).toContain("APP_ORIGIN");
      expect(
        startupProblems({ ...filled(name), ORIGIN_AUTH_SECRET: "too-short" }).join(";"),
      ).toContain("ORIGIN_AUTH_SECRET");
      expect(
        startupProblems({ ...filled(name), R2_ENDPOINT: "https://elsewhere.example" }).join(";"),
      ).toContain("R2_ENDPOINT");
    });

    it(`${name}: validation reports variable names only, never values`, () => {
      const secret = "d".repeat(20); // too short to be accepted
      const problems = startupProblems({ ...filled(name), ORIGIN_AUTH_SECRET: secret });
      expect(problems.join(" ")).not.toContain(secret);
    });
  }

  it("Cloudflare Access is optional in staging, but never half-configured", () => {
    const withoutAccess = Object.fromEntries(
      Object.entries(filled("staging")).filter(([key]) => !key.startsWith("CF_ACCESS_")),
    );
    expect(startupProblems(withoutAccess)).toEqual([]);
    expect(
      startupProblems({ ...filled("staging"), CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "" }),
    ).toEqual([]);
    expect(startupProblems(filled("staging"))).toEqual([]);
    const halves: Record<string, string>[] = [{ CF_ACCESS_AUD: "" }, { CF_ACCESS_TEAM_DOMAIN: "" }];
    for (const half of halves) {
      expect(startupProblems({ ...filled("staging"), ...half }).join(";")).toContain(
        "CF_ACCESS_AUD",
      );
    }
    // Origin authentication stays mandatory in staging whether or not Access is used.
    expect(startupProblems({ ...withoutAccess, ORIGIN_AUTH_SECRET: "" }).join(";")).toContain(
      "ORIGIN_AUTH_SECRET",
    );
    expect(startupProblems(filled("production"))).toEqual([]);
  });

  it("never shares a database or buckets between environments", () => {
    const [s, p] = [template("staging"), template("production")];
    for (const key of [
      "DATABASE_PATH",
      "R2_BUCKET_MEDIA",
      "R2_BUCKET_PRIVATE",
      "R2_BUCKET_BACKUPS",
    ]) {
      expect(s[key], key).toBeTruthy();
      expect(s[key], key).not.toBe(p[key]);
    }
    expect(s.APP_ORIGIN).not.toBe(p.APP_ORIGIN);
  });

  it("docs/railway/variables.md documents every variable of both templates", () => {
    const doc = readFileSync(join(ROOT, "docs", "railway", "variables.md"), "utf8");
    for (const name of ENVIRONMENTS)
      for (const key of Object.keys(template(name))) expect(doc, key).toContain(`\`${key}\``);
    for (const key of APP_VARIABLES) expect(doc, key).toContain(`\`${key}\``);
  });

  it("no Railway config-as-code file can change settings from the repository", () => {
    // Deprecated (read until 2026-12-01) and a way to attach domains or change deploys silently.
    for (const file of ["railway.json", "railway.toml", ".railway"])
      expect(existsSync(join(ROOT, file)), file).toBe(false);
  });
});

describe("secrets hygiene", () => {
  it("documents every secret in .dev.vars.example without values", () => {
    const vars = parseEnv(readFileSync(join(ROOT, ".dev.vars.example"), "utf8")) as Record<
      string,
      string
    >;
    for (const key of [
      "AUTH_SECRET",
      "RESEND_API_KEY",
      "TURNSTILE_SECRET_KEY",
      "GEMINI_API_KEY",
      "SETUP_TOKEN",
    ]) {
      expect(vars, key).toHaveProperty(key);
      expect(vars[key], key).toBe("");
    }
  });

  it("git-ignores local secrets, state and exports", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
    for (const entry of [".dev.vars", ".env", "/backups/", ".vora/", ".wrangler/", "/build/"])
      expect(ignore, entry).toContain(entry);
  });

  it("keeps secrets out of the image build context and the image", () => {
    const dockerignore = readFileSync(join(ROOT, ".dockerignore"), "utf8").split("\n");
    for (const entry of [
      ".dev.vars",
      ".env",
      ".env.*",
      "backups",
      ".vora",
      ".wrangler",
      "node_modules",
      ".git",
    ])
      expect(dockerignore, entry).toContain(entry);
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    for (const key of SEALED) expect(dockerfile, key).not.toMatch(new RegExp(`\\b${key}\\b`));
    expect(dockerfile).toContain("rm -f build/server/.dev.vars");
  });
});

describe("deploy scripts (H2, H4 restated)", () => {
  const scripts = (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  it("deploy:check is build → security scan → image check, and deploys nothing (H2)", () => {
    expect(scripts["deploy:check"]).toBe(
      "npm run build && npm run security:scan && tsx scripts/deploy-check.ts",
    );
  });

  it("no script deploys, provisions or touches a remote resource", () => {
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(
        /\bwrangler\b|railway (up|deploy|link|domain|volume)|--remote|create-?bucket|s3 mb|\bdeploy:(staging|production)\b/,
      );
    }
    expect(Object.keys(scripts).filter((k) => /^deploy:(staging|production)/.test(k))).toEqual([]);
  });

  it("the storage adapter has no bucket-creation call (H4)", () => {
    const source = readFileSync(join(ROOT, "server", "platform", "storage.ts"), "utf8");
    expect(source).not.toMatch(/CreateBucket|createBucket|create-bucket/i);
    // Every write addresses an object key; a PUT on the bucket root is impossible (validKey).
    expect(source).toMatch(/method: "PUT"/);
    expect(source).toMatch(/validKey\(key\)/);
  });
});

describe("the Cloudflare Workers runtime is gone (D23 replacements)", () => {
  it("no Wrangler configuration, Worker entry or Cloudflare packages remain", () => {
    for (const file of [
      "wrangler.jsonc",
      "wrangler.toml",
      "worker-configuration.d.ts",
      "workers/app.ts",
      "public/_headers",
    ])
      expect(existsSync(join(ROOT, file)), file).toBe(false);
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(pkg).not.toMatch(/"wrangler"|@cloudflare\//);
  });

  it("no Durable Object: password hashing is native (the self-test and cross-checks are in tests/unit/argon2-native.test.ts)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const full = join(dir, f);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    for (const file of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "server"))]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/DurableObject|PASSWORD_HASHER|from "cloudflare:/);
    }
  });

  it("exactly the two schedules, in UTC — one in-process scheduler, no cron service", () => {
    expect([...JOB_SCHEDULES]).toEqual(["*/5 * * * *", "17 3 * * *"]);
    const scheduler = readFileSync(join(ROOT, "server", "platform", "scheduler.ts"), "utf8");
    expect(scheduler).toMatch(/timezone: "UTC"/);
  });

  it("the five-minute email run is back to the CP-2.1 batch of 25 (no Free-plan subrequest cap)", () => {
    expect(EMAIL_RETRY_BATCH).toBe(25);
  });
});

describe("the production image (Dockerfile)", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

  it("pins Node 24.21.0 and Litestream by digest", () => {
    expect(dockerfile).toMatch(/node:24\.21\.0-bookworm-slim@sha256:[0-9a-f]{64}/);
    expect(dockerfile).toMatch(/litestream\/litestream:0\.5\.\d+@sha256:[0-9a-f]{64}/);
  });

  it("installs from the lockfile, runs as a non-root user and starts node directly (never npm)", () => {
    expect(dockerfile).toMatch(/npm ci --no-audit --no-fund/);
    expect(dockerfile).toMatch(/npm ci --omit=dev/);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(
      /CMD \["node", "--enable-source-maps", "build\/server\/index\.js"\]/,
    );
    expect(dockerfile).not.toMatch(/CMD \["npm"/);
  });

  it("the entrypoint refuses staging/production without backups and never overwrites a database", () => {
    const entry = readFileSync(join(ROOT, "docker", "entrypoint.sh"), "utf8");
    expect(entry).toMatch(/backups_not_configured/);
    expect(entry).toMatch(/-if-db-not-exists -if-replica-exists/);
    expect(entry).toMatch(/exec litestream replicate/);
  });
});
