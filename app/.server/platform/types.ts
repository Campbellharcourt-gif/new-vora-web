import type { Client } from "@libsql/client";

/**
 * The small set of services the application gets from its platform (Railway migration §2).
 *
 * On Cloudflare Workers these were bindings (D1, R2, Workers Rate Limiting, KV, the execution
 * context). On Railway, `server/platform/*` implements the same shapes in the Node process, so the
 * kernel, routes and services are unchanged. The application depends only on these interfaces;
 * the implementations live outside `app/`.
 */

/** A value that can be bound to a SQL parameter (as D1 accepted). */
export type SqlValue = string | number | bigint | boolean | null | ArrayBuffer | Uint8Array;

/** D1-shaped result metadata; `changes` is SQLite's affected-row count. */
export interface SqlRunMeta {
  changes: number;
  last_row_id: number;
  duration: number;
}

export interface SqlResult<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: SqlRunMeta;
}

/** A prepared statement with D1's interface (`prepare().bind().first()/all()/run()/raw()`). */
export interface SqlStatement {
  readonly sql: string;
  readonly args: readonly SqlValue[];
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

/**
 * The database: SQLite (libSQL) on the service's volume. `client` is what Drizzle uses; the
 * D1-shaped methods serve the health check, scripts and tests that issue raw SQL.
 */
export interface SqlDatabase {
  readonly client: Client;
  prepare(sql: string): SqlStatement;
  /** Runs the statements atomically (one transaction; all or nothing), like D1's batch. */
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
  /** Runs a script of statements (no parameters); not atomic. */
  exec(sql: string): Promise<void>;
}

/** Metadata of a stored object (the subset of R2's that VORA uses). */
export interface StoredObjectInfo {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string; cacheControl?: string; contentDisposition?: string };
  customMetadata?: Record<string, string>;
}

export interface StoredObject extends StoredObjectInfo {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface ObjectPutOptions {
  httpMetadata?: { contentType?: string; cacheControl?: string; contentDisposition?: string };
  customMetadata?: Record<string, string>;
}

export interface ObjectList {
  objects: StoredObjectInfo[];
  truncated: boolean;
  cursor?: string;
}

/**
 * Object storage with R2's method names (`head/get/put/delete/list`). On Railway it talks to R2
 * over its S3 API; there is deliberately no bucket-creation method (the H4 guard, restated).
 */
export interface ObjectStorage {
  head(key: string): Promise<StoredObjectInfo | null>;
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: ObjectPutOptions,
  ): Promise<StoredObjectInfo>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<ObjectList>;
}

/** A rate limiter with the Workers binding's call shape. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Development/test mailbox for the capture email transport, with KV's call shape. */
export interface DevMailbox {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>;
}
