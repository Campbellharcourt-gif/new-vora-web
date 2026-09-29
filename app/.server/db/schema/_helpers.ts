import { type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/** `CHECK (col IN ('a','b'))` for enum-like TEXT columns. Values are static code constants. */
export function inList(column: AnySQLiteColumn, values: readonly string[]): SQL {
  for (const v of values) {
    if (!/^[a-z0-9_.:-]+$/i.test(v)) throw new Error(`Unsafe enum literal: ${v}`);
  }
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}

/** `CHECK (col IN (0,1))` for boolean columns. */
export function isBool(column: AnySQLiteColumn): SQL {
  return sql`${column} in (0, 1)`;
}

/** `CHECK (col IS NULL OR json_valid(col))`. */
export function isJson(column: AnySQLiteColumn): SQL {
  return sql`${column} is null or json_valid(${column})`;
}
