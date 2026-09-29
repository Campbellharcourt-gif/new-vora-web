/** Small, dependency-free encoders used for tokens, IDs and hashes. */

/** Byte arrays backed by a plain ArrayBuffer (what Web Crypto accepts). */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(value: string): Bytes {
  return encoder.encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Bytes {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("Invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Bytes {
  if (/[^A-Za-z0-9_-]/.test(value)) throw new Error("Invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Crockford base32 alphabet (no I, L, O, U) — readable, case-insensitive codes and IDs. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Encodes bytes as Crockford base32 (5 bits per character, most significant first). */
export function toCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/** Normalises user-typed Crockford input: uppercase, I/L→1, O→0, drops separators. */
export function normaliseCrockford(input: string): string {
  return input
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "");
}
