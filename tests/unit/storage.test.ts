import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RecordedRequest, type S3Mock, startS3Mock } from "../../scripts/lib/s3-mock";
import { MemoryStorage, R2Storage } from "../../server/platform/storage";

/**
 * Railway migration R4 (§7, §13.2 item 9): R2 over its S3 API. Requests go to a local S3 mock and
 * each signature is recomputed here with an INDEPENDENT AWS Signature V4 implementation (not the
 * library that made it), so a signing bug cannot hide. No bucket-creation call exists (H4).
 */

const ACCESS_KEY = "AKIDVORATESTKEY00001";
const SECRET_KEY = "vora-test-secret-key/with+symbols=0123456789";

const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** Recomputes the SigV4 signature of a recorded request; true when it matches. */
function signatureValid(req: RecordedRequest): boolean {
  const auth = req.headers.authorization ?? "";
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
      auth,
    );
  if (!match) return false;
  const [, accessKey, date, region, service, signedHeaders, signature] =
    match as unknown as string[];
  if (accessKey !== ACCESS_KEY || region !== "auto" || service !== "s3") return false;
  const [rawPath, rawQuery = ""] = req.url.split("?");
  const canonicalUri = (rawPath as string)
    .split("/")
    .map((segment) => rfc3986(decodeURIComponent(segment)))
    .join("/");
  const canonicalQuery = rawQuery
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const [k, v = ""] = pair.split("=");
      return [rfc3986(decodeURIComponent(k as string)), rfc3986(decodeURIComponent(v))] as const;
    })
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const names = (signedHeaders as string).split(";");
  const canonicalHeaders = names
    .map((n) => `${n}:${(req.headers[n] ?? "").trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const payloadHash = req.headers["x-amz-content-sha256"] ?? sha256(req.body);
  const canonicalRequest = [
    req.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const amzDate = req.headers["x-amz-date"] ?? "";
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(
    hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date as string), region as string), service as string),
    "aws4_request",
  );
  return hmac(key, stringToSign).toString("hex") === signature;
}

let mock: S3Mock;
let storage: R2Storage;

beforeAll(async () => {
  mock = await startS3Mock();
  storage = new R2Storage({
    accountId: "0123456789abcdef",
    bucket: "vora-media-staging",
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    endpoint: mock.endpoint,
  });
});
afterAll(async () => {
  await mock.close();
});

describe("R2 storage adapter (S3 API, SigV4)", () => {
  it("put → head → get → list → delete, each request correctly signed", async () => {
    const key = "media/2026/sail gaming (hero) é+1.avif";
    const body = new Uint8Array([0, 1, 2, 250, 251, 252]);
    const put = await storage.put(key, body, {
      httpMetadata: { contentType: "image/avif", cacheControl: "public, max-age=31536000" },
      customMetadata: { "focal-x": "0.4" },
    });
    expect(put).toMatchObject({ key, size: 6 });

    const head = await storage.head(key);
    expect(head).toMatchObject({ key, size: 6, httpMetadata: { contentType: "image/avif" } });
    expect(head?.customMetadata).toEqual({ "focal-x": "0.4" });

    const got = await storage.get(key);
    expect(
      new Uint8Array(await (got?.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0)))),
    ).toEqual(body);

    await storage.put("media/other.txt", "hello");
    const list = await storage.list({ prefix: "media/" });
    expect(list.objects.map((o) => o.key).sort()).toEqual([key, "media/other.txt"].sort());
    expect(list.truncated).toBe(false);

    await storage.delete([key, "media/other.txt"]);
    expect(await storage.head(key)).toBeNull();
    expect(await storage.get("media/other.txt")).toBeNull();

    expect(mock.requests.length).toBeGreaterThan(8);
    for (const req of mock.requests)
      expect(signatureValid(req), `${req.method} ${req.url}`).toBe(true);
  });

  it("paginates a long listing with the continuation token", async () => {
    for (let i = 0; i < 5; i += 1) await storage.put(`page/${i}`, `v${i}`);
    const first = await storage.list({ prefix: "page/", limit: 2 });
    expect(first.objects).toHaveLength(2);
    expect(first.truncated).toBe(true);
    const second = await storage.list({
      prefix: "page/",
      limit: 10,
      ...(first.cursor ? { cursor: first.cursor } : {}),
    });
    expect(second.objects.map((o) => o.key)).toEqual(["page/2", "page/3", "page/4"]);
  });

  it("never addresses a bucket itself: no bucket-creation or bucket-level write exists (H4)", async () => {
    const before = mock.requests.length;
    await expect(storage.put("", "x")).rejects.toThrow("Invalid object key");
    await expect(storage.head("")).rejects.toThrow("Invalid object key");
    expect(mock.requests.length).toBe(before); // refused before any request
    const bucketLevel = mock.requests.filter((r) => {
      const [path] = r.url.split("?");
      return /^\/[^/]+\/?$/.test(path as string) && r.method !== "GET";
    });
    expect(bucketLevel).toEqual([]);
    expect("createBucket" in storage).toBe(false);
  });

  it("reports provider failures as errors (health turns them into 'down'), never as missing objects", async () => {
    const broken = new R2Storage({
      accountId: "x",
      bucket: "b",
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      endpoint: "http://127.0.0.1:9",
      timeoutMs: 2_000,
    });
    await expect(broken.head("k")).rejects.toThrow();
  });
});

describe("in-memory storage (development and tests)", () => {
  it("offers the same methods", async () => {
    const memory = new MemoryStorage();
    await memory.put("a/1", "one", { httpMetadata: { contentType: "text/plain" } });
    expect(await memory.head("a/1")).toMatchObject({
      size: 3,
      httpMetadata: { contentType: "text/plain" },
    });
    expect(await (await memory.get("a/1"))?.text()).toBe("one");
    expect((await memory.list({ prefix: "a/" })).objects).toHaveLength(1);
    await memory.delete("a/1");
    expect(await memory.head("a/1")).toBeNull();
  });
});
