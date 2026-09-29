import { AwsClient } from "aws4fetch";
import type {
  ObjectList,
  ObjectPutOptions,
  ObjectStorage,
  StoredObject,
  StoredObjectInfo,
} from "../../app/.server/platform/types";

/**
 * Object storage (Railway migration §7). R2 stays; only the access path changes, from a Workers
 * binding to R2's S3-compatible API, signed with AWS Signature V4 (aws4fetch — small, no AWS SDK).
 *
 * The adapter exposes R2's method names (`head/get/put/delete/list`), so `services/health.ts` and
 * the coming media library call it exactly as they called the binding. It has **no bucket
 * creation**: every write addresses an object key inside an existing bucket (the H4 guard,
 * restated for Railway — tests/unit/storage.test.ts asserts it). Credentials are an R2 API token
 * scoped to one environment's buckets (sealed Railway variables).
 */

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Override for tests (a local S3 mock). Default: https://<account>.r2.cloudflarestorage.com */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const encoder = new TextEncoder();

/** A private copy of the bytes (the caller may reuse its buffer). */
function toBytes(value: ArrayBuffer | Uint8Array | string): Uint8Array<ArrayBuffer> {
  if (typeof value === "string") return encoder.encode(value);
  return new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value));
}

function validKey(key: string): string {
  // An empty key would address the bucket itself.
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) {
    throw new TypeError("Invalid object key");
  }
  return key;
}

function xmlDecode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function xmlValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return match?.[1] === undefined ? null : xmlDecode(match[1]);
}

function metaFrom(headers: Headers, key: string): StoredObjectInfo {
  const customMetadata: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.startsWith("x-amz-meta-")) customMetadata[name.slice("x-amz-meta-".length)] = value;
  });
  const httpMetadata: StoredObjectInfo["httpMetadata"] = {};
  const contentType = headers.get("content-type");
  if (contentType) httpMetadata.contentType = contentType;
  const cacheControl = headers.get("cache-control");
  if (cacheControl) httpMetadata.cacheControl = cacheControl;
  const disposition = headers.get("content-disposition");
  if (disposition) httpMetadata.contentDisposition = disposition;
  return {
    key,
    size: Number(headers.get("content-length") ?? 0),
    etag: (headers.get("etag") ?? "").replace(/"/g, ""),
    uploaded: new Date(headers.get("last-modified") ?? 0),
    httpMetadata,
    customMetadata,
  };
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export class R2Storage implements ObjectStorage {
  private readonly client: AwsClient;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: R2Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
      retries: 0,
    });
    const endpoint = config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.base = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(config.bucket)}`;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  private objectUrl(key: string): string {
    return `${this.base}/${validKey(key).split("/").map(encodeURIComponent).join("/")}`;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const signed = await this.client.sign(url, init);
    return this.fetchImpl(signed, { signal: AbortSignal.timeout(this.timeoutMs) });
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const res = await this.send(this.objectUrl(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) throw new StorageError(`R2 head failed (${res.status})`, res.status);
    return metaFrom(res.headers, key);
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.send(this.objectUrl(key), { method: "GET" });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new StorageError(`R2 get failed (${res.status})`, res.status);
    }
    const info = metaFrom(res.headers, key);
    let consumed = false;
    const take = () => {
      if (consumed) throw new TypeError("Body already used");
      consumed = true;
      return res;
    };
    return {
      ...info,
      get body() {
        return take().body as ReadableStream<Uint8Array>;
      },
      arrayBuffer: () => take().arrayBuffer(),
      text: () => take().text(),
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options: ObjectPutOptions = {},
  ): Promise<StoredObjectInfo> {
    const body = toBytes(value);
    const headers = new Headers();
    const http = options.httpMetadata ?? {};
    if (http.contentType) headers.set("content-type", http.contentType);
    if (http.cacheControl) headers.set("cache-control", http.cacheControl);
    if (http.contentDisposition) headers.set("content-disposition", http.contentDisposition);
    for (const [name, value] of Object.entries(options.customMetadata ?? {})) {
      if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new TypeError("Invalid metadata name");
      headers.set(`x-amz-meta-${name}`, value);
    }
    const res = await this.send(this.objectUrl(key), { method: "PUT", headers, body });
    if (!res.ok) throw new StorageError(`R2 put failed (${res.status})`, res.status);
    return {
      key,
      size: body.byteLength,
      etag: (res.headers.get("etag") ?? "").replace(/"/g, ""),
      uploaded: new Date(),
      ...(options.httpMetadata ? { httpMetadata: options.httpMetadata } : {}),
      ...(options.customMetadata ? { customMetadata: options.customMetadata } : {}),
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const res = await this.send(this.objectUrl(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new StorageError(`R2 delete failed (${res.status})`, res.status);
      }
    }
  }

  async list(
    options: { prefix?: string; limit?: number; cursor?: string } = {},
  ): Promise<ObjectList> {
    const url = new URL(this.base);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", String(Math.min(Math.max(options.limit ?? 1000, 1), 1000)));
    if (options.prefix) url.searchParams.set("prefix", options.prefix);
    if (options.cursor) url.searchParams.set("continuation-token", options.cursor);
    const res = await this.send(url.toString(), { method: "GET" });
    if (!res.ok) throw new StorageError(`R2 list failed (${res.status})`, res.status);
    const xml = await res.text();
    const objects: StoredObjectInfo[] = [];
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1] ?? "";
      objects.push({
        key: xmlValue(block, "Key") ?? "",
        size: Number(xmlValue(block, "Size") ?? 0),
        etag: (xmlValue(block, "ETag") ?? "").replace(/"/g, ""),
        uploaded: new Date(xmlValue(block, "LastModified") ?? 0),
      });
    }
    const truncated = xmlValue(xml, "IsTruncated") === "true";
    const cursor = xmlValue(xml, "NextContinuationToken");
    return { objects, truncated, ...(truncated && cursor ? { cursor } : {}) };
  }
}

/** In-memory storage for development and tests (no credentials, nothing leaves the process). */
export class MemoryStorage implements ObjectStorage {
  private readonly objects = new Map<string, { bytes: Uint8Array; info: StoredObjectInfo }>();

  async head(key: string): Promise<StoredObjectInfo | null> {
    return this.objects.get(validKey(key))?.info ?? null;
  }

  async get(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(validKey(key));
    if (!found) return null;
    const bytes = found.bytes;
    return {
      ...found.info,
      get body() {
        return new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>;
      },
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options: ObjectPutOptions = {},
  ): Promise<StoredObjectInfo> {
    const bytes = toBytes(value).slice();
    const info: StoredObjectInfo = {
      key: validKey(key),
      size: bytes.byteLength,
      etag: `mem-${bytes.byteLength}-${Date.now().toString(36)}`,
      uploaded: new Date(),
      ...(options.httpMetadata ? { httpMetadata: options.httpMetadata } : {}),
      ...(options.customMetadata ? { customMetadata: options.customMetadata } : {}),
    };
    this.objects.set(key, { bytes, info });
    return info;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list(
    options: { prefix?: string; limit?: number; cursor?: string } = {},
  ): Promise<ObjectList> {
    const all = [...this.objects.keys()]
      .filter((k) => !options.prefix || k.startsWith(options.prefix))
      .sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000);
    const page = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return {
      objects: page.map((k) => this.objects.get(k)?.info as StoredObjectInfo),
      truncated,
      ...(truncated ? { cursor: String(start + limit) } : {}),
    };
  }
}
