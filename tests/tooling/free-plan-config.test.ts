import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonc } from "../../scripts/lib/jsonc";

/**
 * CP-3 · Cloudflare Free. The Worker configuration must stay deployable on the Workers Free plan
 * (docs/CLOUDFLARE-FREE-COMPATIBILITY.md). Whether Cloudflare actually runs it within the Free
 * limits is verified only on Cloudflare — these checks keep the configuration from drifting back.
 */

const ROOT = process.cwd();

interface DurableObjects {
  bindings?: { name: string; class_name: string; script_name?: string }[];
}
interface Section {
  name?: string;
  limits?: Record<string, unknown>;
  triggers?: { crons?: string[] };
  durable_objects?: DurableObjects;
  migrations?: {
    tag: string;
    new_classes?: string[];
    new_sqlite_classes?: string[];
    deleted_classes?: string[];
  }[];
}
const config = readJsonc<Section & { env: { staging: Section; production: Section } }>(
  join(ROOT, "wrangler.jsonc"),
);
const sections = [
  ["top level (local)", config],
  ["env.staging", config.env.staging],
  ["env.production", config.env.production],
] as const;

describe("Workers Free plan: deployable configuration", () => {
  it("sets no `limits` anywhere (a Free account refuses the deploy while `limits.cpu_ms` is set)", () => {
    for (const [where, section] of sections) expect(section.limits, where).toBeUndefined();
  });

  it("binds the PasswordHasher Durable Object in every environment, in this same Worker", () => {
    for (const [where, section] of sections) {
      expect(section.durable_objects?.bindings, where).toEqual([
        { name: "PASSWORD_HASHER", class_name: "PasswordHasher" },
      ]);
    }
  });

  it("declares PasswordHasher once, SQLite-backed (the only kind the Free plan offers)", () => {
    expect(config.migrations).toEqual([
      { tag: "v1-password-hasher", new_sqlite_classes: ["PasswordHasher"] },
    ]);
    // Migrations are inherited: an environment must not override them with a different history.
    expect(config.env.staging.migrations).toBeUndefined();
    expect(config.env.production.migrations).toBeUndefined();
  });

  it("exports the class from the Worker entry and from the integration-test entry", () => {
    const exportLine = /^export \{ PasswordHasher \} from "[^"]*\/auth\/password-hasher";$/m;
    expect(readFileSync(join(ROOT, "workers", "app.ts"), "utf8")).toMatch(exportLine);
    expect(readFileSync(join(ROOT, "tests", "support", "test-worker.ts"), "utf8")).toMatch(
      exportLine,
    );
  });

  it("uses at most 2 Cron Triggers per environment (staging + production = 4 of a Free account's 5)", () => {
    const crons = config.triggers?.crons ?? [];
    expect(crons.length).toBeLessThanOrEqual(2);
    // Environments inherit the top-level triggers; none adds its own.
    expect(config.env.staging.triggers).toBeUndefined();
    expect(config.env.production.triggers).toBeUndefined();
  });
});
