import { AppError, errors } from "../lib/errors";

/**
 * Private file handling: what may be uploaded, and how it is stored and served.
 *
 * - The type is decided from the file's own bytes (magic numbers), never from the browser's
 *   Content-Type or the name alone; the name's extension must agree with what the bytes are.
 * - Anything that can run in a browser (HTML, SVG, XML, scripts) or on a computer (executables,
 *   installers, macro-enabled Office files) is refused outright.
 * - Image metadata that can identify people or places (EXIF incl. GPS, XMP, IPTC, comments; PNG
 *   text and eXIf chunks) is removed before storage.
 * - Downloads are always attachments with nosniff and a sandbox CSP (see downloadHeaders).
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Multipart overhead allowance when checking Content-Length before reading the body. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export interface SniffedType {
  mime: string;
  kind: "image" | "document" | "video" | "archive";
  extensions: readonly string[];
}

const TYPES: Record<string, SniffedType> = {
  pdf: { mime: "application/pdf", kind: "document", extensions: ["pdf"] },
  png: { mime: "image/png", kind: "image", extensions: ["png"] },
  jpeg: { mime: "image/jpeg", kind: "image", extensions: ["jpg", "jpeg"] },
  gif: { mime: "image/gif", kind: "image", extensions: ["gif"] },
  webp: { mime: "image/webp", kind: "image", extensions: ["webp"] },
  mp4: { mime: "video/mp4", kind: "video", extensions: ["mp4", "m4v"] },
  mov: { mime: "video/quicktime", kind: "video", extensions: ["mov"] },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
    extensions: ["docx"],
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
    extensions: ["xlsx"],
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "document",
    extensions: ["pptx"],
  },
  zip: { mime: "application/zip", kind: "archive", extensions: ["zip"] },
  text: { mime: "text/plain; charset=utf-8", kind: "document", extensions: ["txt", "md"] },
  csv: { mime: "text/csv; charset=utf-8", kind: "document", extensions: ["csv"] },
};

export const ALLOWED_EXTENSIONS = [
  ...new Set(Object.values(TYPES).flatMap((t) => t.extensions)),
].sort();

/** Never accepted, whatever the bytes say (defence in depth for the extension check). */
const BLOCKED_EXTENSIONS = new Set([
  "html",
  "htm",
  "xhtml",
  "svg",
  "svgz",
  "xml",
  "js",
  "mjs",
  "exe",
  "dll",
  "bat",
  "cmd",
  "com",
  "msi",
  "scr",
  "ps1",
  "sh",
  "app",
  "dmg",
  "jar",
  "docm",
  "xlsm",
  "pptm",
  "php",
]);

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** Finds a zip entry name in the archive's local headers (enough to tell Office files apart). */
function zipHasEntry(bytes: Uint8Array, prefix: string): boolean {
  const needle = new TextEncoder().encode(prefix);
  outer: for (let i = 0; i + 30 + needle.length < bytes.length; i++) {
    if (
      bytes[i] !== 0x50 ||
      bytes[i + 1] !== 0x4b ||
      bytes[i + 2] !== 0x03 ||
      bytes[i + 3] !== 0x04
    )
      continue;
    const nameLength = (bytes[i + 26] ?? 0) | ((bytes[i + 27] ?? 0) << 8);
    if (nameLength < needle.length) continue;
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + 30 + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 64 * 1024));
  } catch {
    return false;
  }
  // Text that a browser could treat as markup is refused even as .txt.
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart().toLowerCase();
  return !/^(<!doctype|<html|<svg|<\?xml|<script)/.test(head);
}

export function sniff(bytes: Uint8Array, extension: string): SniffedType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return TYPES.pdf ?? null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return TYPES.png ?? null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return TYPES.jpeg ?? null;
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return TYPES.gif ?? null;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return TYPES.webp ?? null;
  if (ascii(bytes, 4, 8) === "ftyp") {
    return ascii(bytes, 8, 10) === "qt" ? (TYPES.mov ?? null) : (TYPES.mp4 ?? null);
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (zipHasEntry(bytes, "word/")) return TYPES.docx ?? null;
    if (zipHasEntry(bytes, "xl/")) return TYPES.xlsx ?? null;
    if (zipHasEntry(bytes, "ppt/")) return TYPES.pptx ?? null;
    return TYPES.zip ?? null;
  }
  if ((extension === "txt" || extension === "md") && looksLikeText(bytes))
    return TYPES.text ?? null;
  if (extension === "csv" && looksLikeText(bytes)) return TYPES.csv ?? null;
  return null;
}

/** A display-safe file name: no path, no control characters, bounded length. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// --- Metadata removal ----------------------------------------------------------------------------

/** JPEG: drops APP1 (EXIF/XMP, incl. GPS), APP12/13 (IPTC, Photoshop) and comment segments. */
export function stripJpegMetadata(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out: Uint8Array<ArrayBuffer>[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // Not a well-formed marker stream: leave untouched.
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xda) {
      out.push(bytes.subarray(i)); // Start of scan: the rest is image data.
      break;
    }
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > bytes.length) return bytes;
    const drop = marker === 0xe1 || marker === 0xec || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  const total = out.reduce((n, part) => n + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of out) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** PNG: drops text, EXIF and timestamp chunks; image chunks are copied unchanged. */
export function stripPngMetadata(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const drop = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
  const parts: Uint8Array<ArrayBuffer>[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length =
      (((bytes[i] ?? 0) << 24) >>> 0) +
      ((bytes[i + 1] ?? 0) << 16) +
      ((bytes[i + 2] ?? 0) << 8) +
      (bytes[i + 3] ?? 0);
    const type = ascii(bytes, i + 4, i + 8);
    const end = i + 12 + length;
    if (end > bytes.length) return bytes;
    if (!drop.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  const total = parts.reduce((n, part) => n + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// --- Validation entry point ----------------------------------------------------------------------

export interface ValidatedUpload {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  type: SniffedType;
}

export async function validateUpload(file: File | null | undefined): Promise<ValidatedUpload> {
  if (!file || typeof file === "string" || file.size === 0) {
    throw errors.validation({ file: "Choose a file to upload." });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError("payload_too_large", {
      message: `Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    });
  }
  const name = cleanFileName(file.name || "file");
  const extension = extensionOf(name);
  if (!extension || BLOCKED_EXTENSIONS.has(extension) || !ALLOWED_EXTENSIONS.includes(extension)) {
    throw errors.validation({
      file: `This file type isn't accepted. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    });
  }
  let bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes, extension);
  if (!type?.extensions.includes(extension)) {
    throw errors.validation({
      file: "The file's contents don't match its type. Check the file and try again.",
    });
  }
  if (type.mime === "image/jpeg") bytes = stripJpegMetadata(bytes);
  if (type.mime === "image/png") bytes = stripPngMetadata(bytes);
  return { bytes, name, type };
}

/** Headers for serving a private file: always a download, never rendered by the browser. */
export function downloadHeaders(file: { name: string; mime: string; size: number }): Headers {
  const fallback = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Headers({
    "Content-Type": file.mime,
    "Content-Length": String(file.size),
    "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
}
