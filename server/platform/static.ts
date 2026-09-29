import { createReadStream, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";

/**
 * Static files from `build/client` (Railway migration §4.5), served before the kernel — the same
 * split as Workers Static Assets. The set of servable files is read once at start-up; a request
 * path is only ever looked up in that set, never joined onto the filesystem, so there is no path
 * traversal. Hashed assets (`/assets/*`) are immutable for a year; everything else gets a short
 * cache. Every response carries `nosniff` (what `public/_headers` did on Workers).
 */

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".vtt": "text/vtt; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf",
};

export interface StaticFile {
  path: string;
  size: number;
  mtime: Date;
  type: string;
  immutable: boolean;
}

export class StaticFiles {
  private readonly files = new Map<string, StaticFile>();

  constructor(readonly root: string) {
    this.scan(root);
  }

  private scan(dir: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no client build (e.g. tests): nothing is static
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.scan(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const urlPath = `/${relative(this.root, full).split(sep).join("/")}`;
      // Never serve server output, source maps or dotfiles even if a build put them here.
      if (/(^|\/)\./.test(urlPath) || urlPath.endsWith(".map")) continue;
      const stats = statSync(full);
      this.files.set(urlPath, {
        path: full,
        size: stats.size,
        mtime: stats.mtime,
        type: TYPES[extname(entry.name).toLowerCase()] ?? "application/octet-stream",
        immutable: urlPath.startsWith("/assets/"),
      });
    }
  }

  get count(): number {
    return this.files.size;
  }

  lookup(pathname: string): StaticFile | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    return this.files.get(decoded) ?? null;
  }

  /** A response for GET/HEAD of a known file, or null to fall through to the kernel. */
  respond(request: Request, pathname: string): Response | null {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const file = this.lookup(pathname);
    if (!file) return null;
    const etag = `W/"${file.size.toString(16)}-${file.mtime.getTime().toString(16)}"`;
    const headers = new Headers({
      "Content-Type": file.type,
      "Cache-Control": file.immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      ETag: etag,
      "Last-Modified": file.mtime.toUTCString(),
    });
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("Content-Length", String(file.size));
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    const body = Readable.toWeb(createReadStream(file.path)) as unknown as ReadableStream;
    return new Response(body, { status: 200, headers });
  }
}
