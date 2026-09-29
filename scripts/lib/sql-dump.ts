/**
 * Helpers for D1 SQL exports (`wrangler d1 export`), used by the restore tooling (CP-2.1 · A2).
 *
 * Why this exists: an export lists each table in creation order, immediately followed by its
 * rows. VORA's first migration creates several tables that reference `users` before `users`
 * itself, so importing an unmodified export into an empty database stops at the first such row:
 * SQLite needs the referenced table to exist before it can prepare an INSERT into a table with a
 * foreign key ("no such table: main.users") — `PRAGMA defer_foreign_keys` only postpones the
 * constraint check, not that lookup. `prepareRestore` reorders the statements (never changes
 * them) so every table exists before any row is inserted, parents' rows come before children's,
 * and indexes, triggers and views are created last, after the data, exactly as in the export.
 */

export type StatementKind = "pragma" | "table" | "data" | "schema";

export interface ClassifiedStatement {
  sql: string;
  kind: StatementKind;
  /** Table a CREATE TABLE / INSERT belongs to (unquoted). */
  table?: string;
}

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;

/**
 * Splits SQL text into statements. Understands quoted strings and identifiers ('…', "…", `…`,
 * […]), comments (-- and /* *\/), and CREATE TRIGGER bodies (BEGIN … END, including CASE … END
 * inside them), whose inner semicolons do not end the statement.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;
  let words: string[] = []; // first words of the current statement (to recognise CREATE TRIGGER)
  let inTrigger = false;
  let depth = 0; // BEGIN/CASE … END nesting inside a trigger

  const flush = (end: number) => {
    const text = sql.slice(start, end).trim();
    if (text && text !== ";") statements.push(text);
    start = end;
    words = [];
    inTrigger = false;
    depth = 0;
  };

  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unterminated /* comment in SQL.");
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      for (;;) {
        const end = sql.indexOf(close, j);
        if (end < 0) throw new Error(`Unterminated ${ch} quote in SQL.`);
        // A doubled quote character is an escaped quote inside the literal ('' "" ``).
        if (close !== "]" && sql[end + 1] === close) {
          j = end + 2;
          continue;
        }
        i = end + 1;
        break;
      }
      continue;
    }
    if (ch === ";") {
      if (!inTrigger || depth === 0) {
        flush(i + 1);
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    WORD.lastIndex = i;
    const match = WORD.exec(sql);
    if (match) {
      const word = match[0].toUpperCase();
      if (words.length < 4) {
        words.push(word);
        const [a, b, c] = words;
        if (
          a === "CREATE" &&
          (b === "TRIGGER" || ((b === "TEMP" || b === "TEMPORARY") && c === "TRIGGER"))
        )
          inTrigger = true;
      }
      if (inTrigger) {
        if (word === "BEGIN" || word === "CASE") depth += 1;
        else if (word === "END") depth = Math.max(0, depth - 1);
      }
      i += match[0].length;
      continue;
    }
    i += 1;
  }
  flush(sql.length);
  return statements;
}

const NAME = String.raw`("(?:[^"]|"")+"|\x60[^\x60]+\x60|\[[^\]]+\]|'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_$]*)`;
const CREATE_TABLE = new RegExp(
  String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`,
  "i",
);
const INSERT_INTO = new RegExp(String.raw`^INSERT\s+INTO\s+${NAME}`, "i");
const REFERENCES = new RegExp(String.raw`\bREFERENCES\s+${NAME}`, "gi");

export function unquoteName(name: string): string {
  const first = name[0];
  if (first === '"' || first === "`" || first === "'")
    return name.slice(1, -1).replaceAll(first + first, first);
  if (first === "[") return name.slice(1, -1);
  return name;
}

export function classifyStatement(sql: string): ClassifiedStatement {
  const text = sql.trim();
  if (/^PRAGMA\b/i.test(text)) return { sql: text, kind: "pragma" };
  const table = CREATE_TABLE.exec(text);
  if (table) return { sql: text, kind: "table", table: unquoteName(table[1] as string) };
  const insert = INSERT_INTO.exec(text);
  if (insert) return { sql: text, kind: "data", table: unquoteName(insert[1] as string) };
  if (/^DELETE\s+FROM\s+["`]?sqlite_sequence["`]?\s*;?$/i.test(text))
    return { sql: text, kind: "data", table: "sqlite_sequence" };
  if (/^ANALYZE\b/i.test(text)) return { sql: text, kind: "data", table: "sqlite_stat" };
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(text)) return { sql: text, kind: "schema" };
  if (/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?(?:TRIGGER|VIEW)\b/i.test(text))
    return { sql: text, kind: "schema" };
  throw new Error(`Unexpected statement in export (not reordering it): ${text.slice(0, 80)}`);
}

/** Tables referenced by a CREATE TABLE statement's foreign keys (excluding itself). */
export function referencedTables(createTableSql: string, self: string): string[] {
  const out = new Set<string>();
  for (const match of createTableSql.matchAll(REFERENCES)) {
    const name = unquoteName(match[1] as string);
    if (name !== self) out.add(name);
  }
  return [...out];
}

/**
 * Orders tables so that referenced (parent) tables come before the tables that reference them.
 * Stable: otherwise keeps the export's order. Tables in a reference cycle keep their original
 * relative order (their rows then rely on the deferred foreign-key check).
 */
export function parentFirstOrder(tables: { name: string; refs: string[] }[]): string[] {
  const known = new Set(tables.map((t) => t.name));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const byName = new Map(tables.map((t) => [t.name, t]));
  const visit = (name: string) => {
    if (done.has(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const ref of byName.get(name)?.refs ?? []) if (known.has(ref)) visit(ref);
    visiting.delete(name);
    done.add(name);
    order.push(name);
  };
  for (const t of tables) visit(t.name);
  return order;
}

export interface PreparedRestore {
  sql: string;
  counts: { pragma: number; table: number; data: number; schema: number };
  tableOrder: string[];
}

/** Reorders an export for import into an EMPTY database. The statements themselves are unchanged. */
export function prepareRestore(exportSql: string): PreparedRestore {
  const statements = splitSqlStatements(exportSql).map(classifyStatement);
  const pragmas = statements.filter((s) => s.kind === "pragma");
  const tables = statements.filter((s) => s.kind === "table");
  const data = statements.filter((s) => s.kind === "data");
  const schema = statements.filter((s) => s.kind === "schema");

  const order = parentFirstOrder(
    tables.map((t) => ({
      name: t.table as string,
      refs: referencedTables(t.sql, t.table as string),
    })),
  );
  // Rows keep their export order within a table; sqlite_sequence and statistics stay last.
  const rank = new Map(order.map((name, index) => [name, index]));
  const tail = order.length;
  const rankOf = (table: string | undefined) =>
    table === "sqlite_sequence"
      ? tail + 1
      : table === "sqlite_stat"
        ? tail + 2
        : (rank.get(table ?? "") ?? tail);
  const orderedData = data
    .map((s, index) => ({ s, index }))
    .sort((a, b) => rankOf(a.s.table) - rankOf(b.s.table) || a.index - b.index)
    .map(({ s }) => s);

  const ordered = [...pragmas, ...tables, ...orderedData, ...schema];
  if (ordered.length !== statements.length) throw new Error("Reordering lost statements.");
  const text = `${ordered.map((s) => (s.sql.endsWith(";") ? s.sql : `${s.sql};`)).join("\n")}\n`;
  return {
    sql: text,
    counts: {
      pragma: pragmas.length,
      table: tables.length,
      data: data.length,
      schema: schema.length,
    },
    tableOrder: order,
  };
}
