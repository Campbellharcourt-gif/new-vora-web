import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A minimal in-memory S3-compatible endpoint for LOCAL tests and rehearsals only (the storage
 * adapter's unit tests, the HTTPS production-mode run). It implements exactly what VORA's R2
 * adapter uses — HEAD/GET/PUT/DELETE of an object and ListObjectsV2 — and records every request
 * so tests can inspect methods, paths and signatures. It never talks to Cloudflare.
 */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

export interface S3Mock {
  endpoint: string;
  requests: RecordedRequest[];
  objects: Map<string, { body: Buffer; headers: Record<string, string>; modified: Date }>;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function startS3Mock(options: { requireAuth?: boolean } = {}): Promise<S3Mock> {
  const requests: RecordedRequest[] = [];
  const objects: S3Mock["objects"] = new Map();
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers))
      headers[k] = Array.isArray(v) ? v.join(",") : String(v);
    requests.push({ method: req.method ?? "", url: req.url ?? "", headers, body });
    if (options.requireAuth !== false && !/^AWS4-HMAC-SHA256 /.test(headers.authorization ?? "")) {
      res.writeHead(403).end("<Error><Code>AccessDenied</Code></Error>");
      return;
    }
    const url = new URL(req.url ?? "/", "http://mock.invalid");
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    const id = `${decodeURIComponent(bucket ?? "")}/${key}`;
    if (!bucket) {
      res.writeHead(400).end();
      return;
    }
    if (!key) {
      if (req.method !== "GET" || url.searchParams.get("list-type") !== "2") {
        // Anything else on a bucket root (e.g. CreateBucket) is refused and visible in `requests`.
        res.writeHead(405).end("<Error><Code>MethodNotAllowed</Code></Error>");
        return;
      }
      const prefix = `${decodeURIComponent(bucket)}/${url.searchParams.get("prefix") ?? ""}`;
      const max = Number(url.searchParams.get("max-keys") ?? 1000);
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const page = all.slice(start, start + max);
      const truncated = start + max < all.length;
      const contents = page
        .map((k) => {
          const o = objects.get(k);
          return `<Contents><Key>${xml(k.slice(decodeURIComponent(bucket).length + 1))}</Key><Size>${o?.body.length ?? 0}</Size><ETag>"e${o?.body.length ?? 0}"</ETag><LastModified>${o?.modified.toISOString()}</LastModified></Contents>`;
        })
        .join("");
      res
        .writeHead(200, { "content-type": "application/xml" })
        .end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>${contents}${truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : ""}</ListBucketResult>`,
        );
      return;
    }
    const found = objects.get(id);
    switch (req.method) {
      case "PUT": {
        const stored: Record<string, string> = {};
        for (const [k, v] of Object.entries(headers))
          if (
            k.startsWith("x-amz-meta-") ||
            ["content-type", "cache-control", "content-disposition"].includes(k)
          )
            stored[k] = v;
        objects.set(id, { body, headers: stored, modified: new Date() });
        res.writeHead(200, { etag: `"e${body.length}"` }).end();
        return;
      }
      case "HEAD":
      case "GET": {
        if (!found) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, {
          ...found.headers,
          "content-length": String(found.body.length),
          etag: `"e${found.body.length}"`,
          "last-modified": found.modified.toUTCString(),
        });
        res.end(req.method === "GET" ? found.body : undefined);
        return;
      }
      case "DELETE":
        objects.delete(id);
        res.writeHead(204).end();
        return;
      default:
        res.writeHead(405).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    objects,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
