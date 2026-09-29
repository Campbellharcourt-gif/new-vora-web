import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { argon2SelfTest } from "~/.server/auth/password";
import { getConfig } from "~/.server/config/env";
import type { AppModule } from "../../server/app";
import { runCli } from "../../server/cli";
import { openDatabase } from "../../server/platform/sqlite";

/**
 * Railway migration §2 items 21–22: the operator commands inside the production image — what the
 * Wrangler-based scripts did on Workers (migrate, seed, maintenance) plus integrity and the
 * read-only query the operations runbook uses. Run here against a throwaway file.
 */

const work = mkdtempSync(join(tmpdir(), "vora-cli-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const app = { argon2SelfTest, getConfig } as unknown as AppModule;
const paths = {
  migrationsDir: resolve("migrations"),
  defaultDatabasePath: join(work, "unused.db"),
};

async function cli(
  args: string[],
  vars: Record<string, string>,
): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  const code = await runCli(args, app, paths, vars);
  vi.restoreAllMocks();
  return { code, out: lines.join("") };
}

const dev = (db: string) => ({
  APP_ENV: "development",
  APP_ORIGIN: "http://localhost:5173",
  AUTH_SECRET: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  DATABASE_PATH: db,
});

describe("in-container CLI", () => {
  const db = join(work, "cli.db");

  it("migrate, seed, integrity", async () => {
    expect((await cli(["migrate"], dev(db))).out).toContain("0000_initial_schema.sql");
    expect((await cli(["migrate"], dev(db))).out).toContain("none pending");
    const seed = await cli(["seed"], dev(db));
    expect(seed.code).toBe(0);
    expect(seed.out).toContain("DRAFTS only");
    const integrity = await cli(["integrity"], dev(db));
    expect(integrity.code).toBe(0);
    expect(integrity.out).toContain("quick_check: ok");
    expect(integrity.out).toContain("foreign_keys: 1");
  });

  it("maintenance on/off writes the setting, an audit row and a security event", async () => {
    expect((await cli(["maintenance", "on", "Back at 3pm"], dev(db))).code).toBe(0);
    const conn = await openDatabase({ path: db });
    const setting = await conn
      .prepare("SELECT value FROM site_settings WHERE key = 'maintenance'")
      .first<{ value: string }>();
    expect(JSON.parse(setting?.value ?? "{}")).toEqual({ enabled: true, message: "Back at 3pm" });
    expect(
      await conn
        .prepare("SELECT count(*) AS n FROM audit_logs WHERE target_id = 'maintenance'")
        .first("n"),
    ).toBe(1);
    expect(
      await conn
        .prepare("SELECT count(*) AS n FROM security_events WHERE type = 'maintenance.changed'")
        .first("n"),
    ).toBe(1);
    conn.close();
    expect((await cli(["maintenance", "off"], dev(db))).code).toBe(0);
    expect((await cli(["maintenance", "sideways"], dev(db))).code).toBe(2);
  });

  it("query is read-only; exec needs --confirm-write and one statement", async () => {
    const roles = await cli(["query", "SELECT key FROM roles ORDER BY rank DESC"], dev(db));
    expect(JSON.parse(roles.out).map((r: { key: string }) => r.key)).toContain("owner");
    for (const sql of [
      "DELETE FROM roles",
      "SELECT 1; DELETE FROM roles",
      "UPDATE users SET status = 'x'",
    ]) {
      expect((await cli(["query", sql], dev(db))).code, sql).toBe(2);
    }
    expect((await cli(["exec", "DELETE FROM job_runs"], dev(db))).code).toBe(2);
    expect(
      (await cli(["exec", "DELETE FROM job_runs; DELETE FROM users", "--confirm-write"], dev(db)))
        .code,
    ).toBe(2);
    const write = await cli(["exec", "DELETE FROM job_runs", "--confirm-write"], dev(db));
    expect(write.code).toBe(0);
    expect(write.out).toContain("Rows affected");
    // The protective triggers still apply to operator writes.
    const guarded = await cli(
      ["exec", "UPDATE audit_logs SET summary = 'x'", "--confirm-write"],
      dev(db),
    ).catch((e: unknown) => ({ code: 1, out: String(e) }));
    expect(guarded.out).toContain("append-only");
  });

  it("check validates platform AND application configuration, and runs the Argon2id self-test", async () => {
    expect((await cli(["check"], dev(db))).code).toBe(0);
    const production = {
      APP_ENV: "production",
      APP_ORIGIN: "https://vorawebsites.store",
      AUTH_SECRET: "a".repeat(48),
      EMAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_x",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA", // Cloudflare test key: refused (H1)
      TURNSTILE_SECRET_KEY: "secret",
      ORIGIN_AUTH_SECRET: "o".repeat(40),
      DATABASE_PATH: "/data/vora.db",
      R2_ACCOUNT_ID: "a",
      R2_BUCKET_MEDIA: "m",
      R2_BUCKET_PRIVATE: "p",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
    };
    const refused = await cli(["check"], production);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("TURNSTILE_SITE_KEY");
    expect(refused.out).not.toContain("1x00000000000000000000AA");
    expect(
      (await cli(["check"], { ...production, TURNSTILE_SITE_KEY: "real-looking-key" })).code,
    ).toBe(0);
  });
});
