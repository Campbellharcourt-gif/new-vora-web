import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classifyStatement,
  parentFirstOrder,
  prepareRestore,
  referencedTables,
  splitSqlStatements,
} from "../../scripts/lib/sql-dump";
import { openDatabase, type SqliteDatabase } from "../../server/platform/sqlite";

/**
 * CP-2.1 · A2 — restoring a D1 export into an empty database.
 *
 * An export lists each table in creation order followed by its rows; VORA creates tables that
 * reference `users` before `users`, so an unmodified export cannot be imported into an empty
 * database ("no such table: main.users"). `restore-prepare` reorders — never edits — the
 * statements. The last block proves both facts on a real SQLite engine (libSQL — the engine VORA
 * now runs on; on CP-3 it used the Wrangler/D1 simulator), on throwaway files only. Railway
 * backups are Litestream replicas and `VACUUM INTO` copies (scripts/restore-rehearsal.ts); this
 * tool stays for importing a D1-style SQL export.
 */

const ROOT = process.cwd();
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

// The shape of a real export (see node_modules/miniflare …/d1/dumpSql): tables in creation
// order, each followed by its rows; sqlite_sequence last; then indexes, triggers and views.
const EXPORT = [
  "PRAGMA defer_foreign_keys=TRUE;",
  "CREATE TABLE `notes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`user_id` text,\n\t`body` text,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade\n);",
  `INSERT INTO "notes" ("id","user_id","body") VALUES('n1','u1',replace('first line\\nit''s; fine','\\n',char(10)));`,
  "CREATE TABLE `users` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`email` text NOT NULL,\n\t`invited_by` text REFERENCES `users`(`id`)\n);",
  `INSERT INTO "users" ("id","email","invited_by") VALUES('u1','private.person@example.test',NULL);`,
  'CREATE TABLE IF NOT EXISTS "d1_migrations"(\n\t\tid INTEGER PRIMARY KEY AUTOINCREMENT,\n\t\tname TEXT UNIQUE\n);',
  `INSERT INTO "d1_migrations" ("id","name") VALUES(1,'0000_initial.sql');`,
  "DELETE FROM sqlite_sequence;",
  `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);`,
  "CREATE INDEX `notes_user_idx` ON `notes` (`user_id`);",
  "CREATE TRIGGER `notes_no_update` BEFORE UPDATE ON `notes`\nBEGIN\n  SELECT CASE WHEN 1 THEN RAISE(ABORT, 'notes are append-only; really') END;\n  SELECT 1;\nEND;",
].join("\n");

describe("splitting SQL into statements", () => {
  it("keeps semicolons inside strings, identifiers, comments and trigger bodies", () => {
    const sql = [
      "SELECT 'a;b', \"c;d\", `e;f`, [g;h];",
      "-- a comment; with a semicolon\nSELECT 'it''s';",
      "/* block; comment */ SELECT 2;",
      "CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES (1); SELECT CASE WHEN 1 THEN 2 ELSE 3 END; END;",
      "SELECT 3",
    ].join("\n");
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe("SELECT 'a;b', \"c;d\", `e;f`, [g;h];");
    expect(out[3]).toMatch(/^CREATE TRIGGER t .* END;$/s);
    expect(out[4]).toBe("SELECT 3");
  });

  it("splits a real-shaped export into its statements", () => {
    expect(splitSqlStatements(EXPORT)).toHaveLength(11);
  });

  it("refuses malformed SQL instead of guessing", () => {
    expect(() => splitSqlStatements("SELECT 'unterminated;")).toThrow(/Unterminated/);
    expect(() => splitSqlStatements("SELECT 1 /* open")).toThrow(/Unterminated/);
  });
});

describe("classifying and ordering", () => {
  it("classifies export statements and refuses anything unexpected", () => {
    expect(classifyStatement("PRAGMA defer_foreign_keys=TRUE;").kind).toBe("pragma");
    expect(classifyStatement('CREATE TABLE IF NOT EXISTS "d1_migrations"(id)')).toMatchObject({
      kind: "table",
      table: "d1_migrations",
    });
    expect(classifyStatement('INSERT INTO "users" ("id") VALUES(1);')).toMatchObject({
      kind: "data",
      table: "users",
    });
    expect(classifyStatement("DELETE FROM sqlite_sequence;").kind).toBe("data");
    expect(classifyStatement("CREATE UNIQUE INDEX `a` ON `b` (`c`);").kind).toBe("schema");
    expect(
      classifyStatement("CREATE TRIGGER `t` BEFORE DELETE ON `x` BEGIN SELECT 1; END;").kind,
    ).toBe("schema");
    // A tampered or unexpected file is never "reordered" into something destructive.
    expect(() => classifyStatement("DROP TABLE users;")).toThrow(/Unexpected statement/);
    expect(() => classifyStatement("DELETE FROM users;")).toThrow(/Unexpected statement/);
  });

  it("puts referenced tables first, keeps the export order otherwise, and survives cycles", () => {
    expect(referencedTables(splitSqlStatements(EXPORT)[1] ?? "", "notes")).toEqual(["users"]);
    expect(
      referencedTables(
        "CREATE TABLE `users` (`invited_by` text REFERENCES `users`(`id`))",
        "users",
      ),
    ).toEqual([]);
    expect(
      parentFirstOrder([
        { name: "notes", refs: ["users"] },
        { name: "audit", refs: [] },
        { name: "users", refs: ["roles"] },
        { name: "roles", refs: [] },
      ]),
    ).toEqual(["roles", "users", "notes", "audit"]);
    expect(
      parentFirstOrder([
        { name: "a", refs: ["b"] },
        { name: "b", refs: ["a"] },
      ]),
    ).toEqual(["b", "a"]);
  });

  it("prepares an export: tables first, parents' rows first, indexes and triggers last — same statements", () => {
    const prepared = prepareRestore(EXPORT);
    const out = splitSqlStatements(prepared.sql);
    expect(out.map((s) => classifyStatement(s).kind)).toEqual([
      "pragma",
      "table",
      "table",
      "table",
      "data",
      "data",
      "data",
      "data",
      "data",
      "schema",
      "schema",
    ]);
    const rowOrder = out.filter((s) => s.startsWith("INSERT") || s.startsWith("DELETE"));
    expect(rowOrder[0]).toContain('INSERT INTO "users"');
    expect(rowOrder[1]).toContain('INSERT INTO "notes"');
    expect(rowOrder.slice(-2)).toEqual([
      "DELETE FROM sqlite_sequence;",
      `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);`,
    ]);
    // Reordered only: exactly the same statements, byte for byte.
    expect([...out].sort()).toEqual([...splitSqlStatements(EXPORT)].sort());
    expect(prepared.counts).toEqual({ pragma: 1, table: 3, data: 5, schema: 2 });
  });
});

describe("command-line tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "vora-restore-cli-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("restore-prepare writes <name>.restore.sql beside the export and never prints its contents", () => {
    const input = join(dir, "vora-production-stamp.sql");
    writeFileSync(input, EXPORT);
    const run = spawnSync(TSX, ["scripts/restore-prepare.ts", input], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(join(dir, "vora-production-stamp.restore.sql"))).toBe(true);
    expect(run.stdout).toContain("3 tables first");
    expect(run.stdout + run.stderr).not.toContain("private.person@example.test");
    const same = spawnSync(TSX, ["scripts/restore-prepare.ts", input, "--out", input], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(same.status).toBe(2);
    expect(readFileSync(input, "utf8")).toBe(EXPORT);
  });

  it("the restore rehearsal refuses --remote and --env before doing anything", () => {
    for (const flag of [["--remote"], ["--env", "production"]]) {
      const run = spawnSync(TSX, ["scripts/restore-rehearsal.ts", ...flag], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(run.status, flag.join(" ")).toBe(2);
      expect(run.stderr).toContain("local-only");
    }
  });
});

describe("on a real SQLite engine (libSQL), on throwaway files", { timeout: 120_000 }, () => {
  const work = mkdtempSync(join(tmpdir(), "vora-restore-libsql-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  // The same creation-order problem as VORA's first migration: `notes` references `users` before
  // `users` exists — exactly how a D1 export lists them (creation order, each table's rows after
  // it, sqlite_sequence last, then indexes and triggers).
  const D1_STYLE_EXPORT = [
    "PRAGMA defer_foreign_keys=TRUE;",
    "CREATE TABLE `notes` (`id` text PRIMARY KEY NOT NULL, `user_id` text REFERENCES `users`(`id`), `body` text, `data` blob);",
    `INSERT INTO "notes" ("id","user_id","body","data") VALUES('n1','u1','line one' || char(10) || 'it''s; fine',X'00ff10');`,
    "CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL);",
    `INSERT INTO "users" ("id","email") VALUES('u1','a@example.test');`,
    "CREATE TABLE `counters` (`id` integer PRIMARY KEY AUTOINCREMENT, `n` integer);",
    `INSERT INTO "counters" ("id","n") VALUES(1,1);`,
    `INSERT INTO "counters" ("id","n") VALUES(2,2);`,
    "DELETE FROM sqlite_sequence;",
    `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('counters',2);`,
    "CREATE TRIGGER `notes_no_update` BEFORE UPDATE ON `notes` BEGIN SELECT RAISE(ABORT, 'notes are append-only'); END;",
  ].join("\n");

  async function fresh(label: string): Promise<SqliteDatabase> {
    return openDatabase({ path: join(work, `${label}.db`) });
  }

  async function rows(db: SqliteDatabase) {
    const out = [];
    for (const sql of [
      "SELECT * FROM users",
      "SELECT id, user_id, body, hex(data) AS data FROM notes",
      "SELECT * FROM counters",
      "SELECT * FROM sqlite_sequence",
    ])
      out.push((await db.prepare(sql).all()).results);
    return out;
  }

  it("an unmodified export cannot be restored into an empty database; the prepared file can, exactly", async () => {
    // The source database, built in a valid order (parents first), as the live database was.
    const source = await fresh("source");
    await source.exec(
      [
        "CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL);",
        "CREATE TABLE `notes` (`id` text PRIMARY KEY NOT NULL, `user_id` text REFERENCES `users`(`id`), `body` text, `data` blob);",
        "CREATE TABLE `counters` (`id` integer PRIMARY KEY AUTOINCREMENT, `n` integer);",
        "INSERT INTO users VALUES ('u1', 'a@example.test');",
        "INSERT INTO notes VALUES ('n1', 'u1', 'line one' || char(10) || 'it''s; fine', X'00ff10');",
        "INSERT INTO counters (n) VALUES (1), (2);",
        "CREATE TRIGGER `notes_no_update` BEFORE UPDATE ON `notes` BEGIN SELECT RAISE(ABORT, 'notes are append-only'); END;",
      ].join("\n"),
    );

    // As-is into an empty database, with foreign keys enforced (as D1 and VORA's libSQL do).
    const raw = await fresh("raw");
    const rawError = await raw.exec(D1_STYLE_EXPORT).then(
      () => null,
      (e: unknown) => String(e),
    );
    expect(rawError).toContain("no such table: main.users");
    raw.close();

    const target = await fresh("restored");
    await target.exec(prepareRestore(D1_STYLE_EXPORT).sql);
    expect(await rows(target)).toEqual(await rows(source));
    await expect(target.prepare("UPDATE notes SET body = 'x'").run()).rejects.toThrow(
      "notes are append-only",
    );
    source.close();
    target.close();
  });
});
