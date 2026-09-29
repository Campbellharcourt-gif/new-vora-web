import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Deployment configuration guard rails (wrangler.jsonc, env examples, ignore rules). These are
 * checked locally; whether Cloudflare actually matches them is verified only after a deploy.
 */

/** Removes // and /* *\/ comments outside strings, so JSONC parses as JSON. */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += ch;
  }
  return out;
}

interface EnvConfig {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown[];
  vars?: Record<string, string>;
  d1_databases?: { binding: string; database_name: string; migrations_dir?: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  kv_namespaces?: { binding: string }[];
  ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
}
interface WranglerConfig extends EnvConfig {
  main: string;
  compatibility_flags?: string[];
  observability?: { enabled?: boolean };
  triggers?: { crons?: string[] };
  env: { staging: EnvConfig; production: EnvConfig };
}

const config = JSON.parse(
  stripJsonComments(readFileSync("wrangler.jsonc", "utf8")),
) as WranglerConfig;
const SECRET_NAMES = [
  "AUTH_SECRET",
  "AUTH_SECRET_PREVIOUS",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
  "GEMINI_API_KEY",
  "SETUP_TOKEN",
];

describe("wrangler.jsonc", () => {
  it("parses, runs with nodejs_compat, observability and both cron jobs", () => {
    expect(config.main).toBe("./workers/app.ts");
    expect(config.compatibility_flags).toContain("nodejs_compat");
    expect(config.observability?.enabled).toBe(true);
    expect(config.triggers?.crons).toEqual(["*/5 * * * *", "17 3 * * *"]);
  });

  it("keeps secrets out of plain vars in every environment", () => {
    for (const env of [config, config.env.staging, config.env.production]) {
      for (const name of SECRET_NAMES) expect(env.vars ?? {}, name).not.toHaveProperty(name);
    }
  });

  for (const name of ["staging", "production"] as const) {
    it(`${name}: production-grade settings and complete bindings`, () => {
      const env = config.env[name];
      expect(env.workers_dev, "no *.workers.dev exposure").toBe(false);
      expect(env.preview_urls, "no public preview URLs").toBe(false);
      expect(env.vars?.APP_ENV).toBe(name);
      expect(env.vars?.APP_ORIGIN).toMatch(/^https:\/\//);
      expect(env.vars?.EMAIL_TRANSPORT).toBe("resend");
      expect(env.vars?.MAINTENANCE_MODE).toBe("off");
      expect(env.vars?.LOG_LEVEL).not.toBe("debug");
      expect(env.kv_namespaces?.some((k) => k.binding === "DEV_MAILBOX") ?? false).toBe(false);
      expect(env.d1_databases?.map((d) => [d.binding, d.migrations_dir])).toEqual([
        ["DB", "migrations"],
      ]);
      expect(env.r2_buckets?.map((b) => b.binding).sort()).toEqual(["MEDIA", "PRIVATE"]);
      expect(env.ratelimits?.map((r) => r.name).sort()).toEqual([
        "RL_AI",
        "RL_API",
        "RL_AUTH",
        "RL_FORMS",
      ]);
    });
  }

  it("never shares databases, buckets or rate-limit namespaces between environments", () => {
    const envs = [config, config.env.staging, config.env.production];
    const all = (pick: (e: EnvConfig) => string[]) => envs.flatMap(pick);
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(all((e) => (e.d1_databases ?? []).map((d) => d.database_name)))).toBe(true);
    expect(unique(all((e) => (e.r2_buckets ?? []).map((b) => b.bucket_name)))).toBe(true);
    expect(unique(all((e) => (e.ratelimits ?? []).map((r) => r.namespace_id)))).toBe(true);
    expect(unique(envs.map((e) => e.name ?? ""))).toBe(true);
  });

  it("does not attach the live domain to production before the planned cutover", () => {
    // vorawebsites.store is served by the Mark4 proxy until the cutover in
    // docs/runbooks/deployment.md §8 — update this test deliberately as part of that step.
    expect(config.env.production.routes).toBeUndefined();
  });
});

describe("secrets hygiene", () => {
  it("documents every secret in .dev.vars.example without values", () => {
    const example = readFileSync(".dev.vars.example", "utf8");
    for (const name of SECRET_NAMES) expect(example, name).toMatch(new RegExp(`^${name}=$`, "m"));
  });

  it("git-ignores local secrets, state and exports", () => {
    const ignore = readFileSync(".gitignore", "utf8").split("\n");
    for (const entry of [".dev.vars", ".wrangler/", "/backups/", "/build/", "node_modules/"]) {
      expect(ignore, entry).toContain(entry);
    }
  });
});
