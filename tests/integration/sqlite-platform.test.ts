import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, schema } from "~/.server/db/client";
import {
  integrityCheck,
  MigrationError,
  migrate,
  openDatabase,
  readMigrations,
  readPragmas,
  type SqliteDatabase,
  snapshotDatabase,
  verifyPragmas,
} from "../../server/platform/sqlite";
import { env } from "../support/helpers";

/**
 * Railway migration R3 (§6.4–6.6, §13.2 items 2 and 10): SQLite through libSQL on a volume file.
 * The whole integration suite already runs on this driver (every other file); this one proves the
 * platform properties themselves — foreign keys, WAL, atomic batches, migrations at start-up with
 * snapshots, concurrency, restart, backup and restore.
 */

const work = mkdtempSync(join(tmpdir(), "vora-sqlite-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const MIGRATIONS = readMigrations(resolve("migrations"));
let seq = 0;
const fileDb = () => join(work, `db-${++seq}`, "vora.db");

async function migrated(path = fileDb()): Promise<SqliteDatabase> {
  const db = await openDatabase({ path });
  await migrate(db, MIGRATIONS);
  return db;
}

async function fingerprint(db: SqliteDatabase): Promise<string> {
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all<{ name: string }>()
  ).results.map((r) => r.name);
  const parts: string[] = [];
  for (const t of tables) {
    const rows = (await db.prepare(`SELECT * FROM "${t}"`).all()).results
      .map((r) => JSON.stringify(r))
      .sort();
    parts.push(`${t}:${rows.length}:${rows.join("|")}`);
  }
  return parts.join("\n");
}

describe("foreign keys are enforced (D1 enforced them; plain SQLite does not by default)", () => {
  it("the application's connection reports foreign_keys = 1 and rejects a violation", async () => {
    expect((await readPragmas(env.DB as SqliteDatabase)).foreignKeys).toBe(1);
    await expect(
      env.DB.prepare(
        "insert into user_roles (user_id, role_id, granted_at) values ('usr_x', 'rol_x', 1)",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("…through Drizzle too, and ON DELETE CASCADE still works", async () => {
    const db = createDb(env.DB);
    await expect(
      db
        .insert(schema.userRoles)
        .values({ userId: "usr_missing", roleId: "rol_missing", grantedAt: 1 }),
    ).rejects.toThrow();
    const file = await migrated();
    await file.exec(
      "INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at) VALUES ('usr_1', 'a@example.test', 'A', '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'active', 1, 1);" +
        "INSERT INTO sessions (id, user_id, auth_level, auth_method, created_at, last_seen_at, idle_expires_at, expires_at) VALUES ('ses_1', 'usr_1', 'full', 'password', 1, 1, 9, 9);",
    );
    await file.prepare("DELETE FROM users WHERE id = 'usr_1'").run();
    expect(await file.prepare("SELECT count(*) AS n FROM sessions").first("n")).toBe(0);
    file.close();
  });

  it("a brand-new libSQL connection starts with foreign keys ON (compile-time default), so a pool reconnect cannot switch them off", async () => {
    const path = fileDb();
    (await openDatabase({ path })).close();
    const raw = createClient({ url: `file:${path}` });
    expect((await raw.execute("PRAGMA foreign_keys")).rows[0]?.[0]).toBe(1);
    raw.close();
  });

  it("the server refuses to continue if enforcement is ever off", async () => {
    const db = await openDatabase({ path: fileDb() });
    await db.client.execute("PRAGMA foreign_keys = OFF");
    await expect(verifyPragmas(db)).rejects.toThrow(/foreign-key enforcement is OFF/);
    db.close();
  });
});

describe("connection settings", () => {
  it("file databases run in WAL with synchronous=NORMAL and a busy timeout", async () => {
    const db = await openDatabase({ path: fileDb() });
    expect(await readPragmas(db)).toEqual({
      foreignKeys: 1,
      journalMode: "wal",
      busyTimeout: 5000,
      synchronous: 1,
    });
    db.close();
  });
});

describe("atomic batches (the D1 batch guarantee)", () => {
  it("a batch rolls back as a whole when any statement fails", async () => {
    const db = await migrated();
    await expect(
      db.batch([
        db.prepare(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ('batch.test', '1', 1)",
        ),
        db.prepare(
          "INSERT INTO user_roles (user_id, role_id, granted_at) VALUES ('usr_none', 'rol_none', 1)",
        ),
      ]),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM site_settings WHERE key = 'batch.test'")
        .first("n"),
    ).toBe(0);

    const drizzle = createDb(db);
    await expect(
      drizzle.batch([
        drizzle
          .insert(schema.siteSettings)
          .values({ key: "batch.drizzle", value: 1, updatedAt: 1 }),
        drizzle.run(sql`INSERT INTO no_such_table VALUES (1)`),
      ]),
    ).rejects.toThrow();
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM site_settings WHERE key = 'batch.drizzle'")
        .first("n"),
    ).toBe(0);
    db.close();
  });

  it("keeps SQLite's constraint text, which duplicate-enquiry detection relies on", async () => {
    const db = await migrated();
    await db.exec("CREATE TABLE t (k TEXT UNIQUE)");
    await db.prepare("INSERT INTO t VALUES ('a')").run();
    await expect(db.prepare("INSERT INTO t VALUES ('a')").run()).rejects.toThrow(
      "UNIQUE constraint failed: t.k",
    );
    db.close();
  });

  it("an interactive transaction commits or rolls back, and enforcement holds afterwards", async () => {
    const db = await migrated();
    const tx = await db.client.transaction("write");
    await tx.execute("INSERT INTO site_settings (key, value, updated_at) VALUES ('tx.a', '1', 1)");
    await tx.rollback();
    expect(
      await db.prepare("SELECT count(*) AS n FROM site_settings WHERE key = 'tx.a'").first("n"),
    ).toBe(0);
    expect((await readPragmas(db)).foreignKeys).toBe(1);
    db.close();
  });
});

describe("migrations at start-up (§6.5)", () => {
  it("a fresh file gets every migration; a second start applies none", async () => {
    const path = fileDb();
    const db = await openDatabase({ path });
    const first = await migrate(db, MIGRATIONS);
    expect(first.applied).toEqual([
      "0000_initial_schema.sql",
      "0001_integrity_triggers.sql",
      "0002_owner_guards.sql",
      "0003_engagement_services.sql",
    ]);
    expect(first.snapshot).toBeNull(); // nothing to protect in an empty database
    expect((await migrate(db, MIGRATIONS)).applied).toEqual([]);
    const triggers = await db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'")
      .first("n");
    expect(triggers).toBe(9);
    db.close();
  });

  it("a failing migration stops start-up, applies nothing from that file, and leaves the snapshot", async () => {
    const dir = join(work, "failing-migrations");
    cpSync(resolve("migrations"), dir, { recursive: true });
    writeFileSync(
      join(dir, "0099_broken.sql"),
      "CREATE TABLE half_done (id integer);\n--> statement-breakpoint\nINSERT INTO no_such_table VALUES (1);\n",
    );
    const path = fileDb();
    const db = await migrated(path);
    await db
      .prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('before', '1', 1)")
      .run();
    const error = await migrate(db, readMigrations(dir)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).migration).toBe("0099_broken.sql");
    const snapshot = (error as MigrationError).snapshot as string;
    expect(existsSync(snapshot)).toBe(true);
    expect(
      await db
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'half_done'")
        .first("n"),
    ).toBe(0);
    expect(await db.prepare("SELECT count(*) AS n FROM d1_migrations").first("n")).toBe(
      MIGRATIONS.length,
    );
    // The snapshot is the pre-migration database, usable as it is.
    const restored = await openDatabase({ path: snapshot });
    expect(
      await restored
        .prepare("SELECT count(*) AS n FROM site_settings WHERE key = 'before'")
        .first("n"),
    ).toBe(1);
    restored.close();
    db.close();
  });

  it("keeps only the last three pre-migration snapshots", async () => {
    const path = fileDb();
    const db = await migrated(path);
    for (let i = 0; i < 5; i += 1)
      await snapshotDatabase(db, { now: new Date(Date.UTC(2026, 8, 1 + i)) });
    const snapshots = readdirSync(join(path, "..")).filter((f) => f.startsWith("pre-migrate-"));
    expect(snapshots).toHaveLength(3);
    db.close();
  });
});

describe("concurrency, restart, backup and restore", () => {
  it("the server and a second writer (the CLI) write concurrently without SQLITE_BUSY", async () => {
    const path = fileDb();
    const server = await migrated(path);
    const cli = await openDatabase({ path });
    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        (i % 2 ? server : cli)
          .prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, '1', ?)")
          .bind(`concurrent.${i}`, i)
          .run(),
      ),
    );
    expect(
      await server
        .prepare("SELECT count(*) AS n FROM site_settings WHERE key LIKE 'concurrent.%'")
        .first("n"),
    ).toBe(60);
    cli.close();
    server.close();
  });

  it("after a shutdown and restart the data, the ledger and the settings are intact", async () => {
    const path = fileDb();
    const first = await migrated(path);
    await first
      .prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('persist', '1', 1)")
      .run();
    first.close();
    const second = await openDatabase({ path });
    expect((await migrate(second, MIGRATIONS)).applied).toEqual([]);
    expect(
      await second
        .prepare("SELECT count(*) AS n FROM site_settings WHERE key = 'persist'")
        .first("n"),
    ).toBe(1);
    expect(await readPragmas(second)).toMatchObject({ foreignKeys: 1, journalMode: "wal" });
    expect(await integrityCheck(second)).toEqual({ quickCheck: "ok", foreignKeyViolations: 0 });
    second.close();
  });

  it("a snapshot backup restores to an identical, healthy database", async () => {
    const source = await migrated();
    await source.exec(
      "INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at) VALUES ('usr_b', 'b@example.test', 'B', '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'active', 1, 1);",
    );
    const backup = await snapshotDatabase(source);
    // Restore = copy the single-file snapshot into place (a fresh directory), then open it.
    const restorePath = join(work, "restored", "vora.db");
    mkdirSync(join(work, "restored"), { recursive: true });
    copyFileSync(backup, restorePath);
    const restored = await openDatabase({ path: restorePath });
    expect(await fingerprint(restored)).toBe(await fingerprint(source));
    expect((await migrate(restored, MIGRATIONS)).applied).toEqual([]);
    expect(await integrityCheck(restored)).toEqual({ quickCheck: "ok", foreignKeyViolations: 0 });
    restored.close();
    source.close();
  });
});
