export interface CookieOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  path?: string;
}

const NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const VALUE_PATTERN = /^[!#$%&'()*+\-./0-9:<=>?@A-Z[\]^_`a-z{|}~]*$/;

/** Serialises a Set-Cookie value. Rejects names/values that could inject attributes. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!NAME_PATTERN.test(name)) throw new Error("Invalid cookie name");
  if (!VALUE_PATTERN.test(value)) throw new Error("Invalid cookie value");
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
    if (options.maxAgeSeconds <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }
  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (options.secure ?? true) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

export function readCookie(request: Request, name: string): string | undefined {
  return parseCookies(request.headers.get("cookie")).get(name);
}
