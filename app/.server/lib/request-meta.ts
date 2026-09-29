/**
 * Server-derived facts about a request. Only Cloudflare-set headers are trusted for the client
 * IP (`CF-Connecting-IP`); `X-Forwarded-For` is never used for security decisions.
 *
 * Railway migration R5: location and network come from headers Cloudflare adds on the way to the
 * origin — `CF-IPCountry`, the "Add visitor location headers" managed transform (`cf-region`,
 * `cf-ipcity`) and a Transform Rule setting `X-Vora-ASN` to `ip.src.asnum` — instead of Workers'
 * `request.cf`. The Node adapter (server/platform/trust.ts) is the only way in: in staging and
 * production it refuses any request without the valid origin-auth header, and in development and
 * tests it overwrites `CF-Connecting-IP` with the socket address and deletes the other trusted
 * headers. So by the time a request reaches this code, these headers are Cloudflare's own.
 */
export interface RequestMeta {
  ip: string;
  ipPrefix: string;
  userAgent: string;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
}

export function ipPrefix(ip: string): string {
  if (ip.includes(":")) {
    // IPv6: keep the first three hextets (/48).
    const parts = ip.split(":").filter((p) => p.length > 0);
    return `${parts.slice(0, 3).join(":")}::/48`;
  }
  const octets = ip.split(".");
  if (octets.length === 4) return `${octets.slice(0, 3).join(".")}.0/24`;
  return "unknown";
}

/**
 * Headers the platform adapter treats as trusted (set by Cloudflare, never by a visitor). Listed
 * here so the adapter and this reader cannot drift apart.
 */
export const TRUSTED_CLIENT_HEADERS = [
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-region",
  "cf-ipcity",
  "x-vora-asn",
  "cf-ray",
] as const;

function headerText(request: Request, name: string, max: number): string | null {
  const value = request.headers.get(name)?.trim();
  if (!value) return null;
  // Cloudflare percent-encodes non-ASCII city names; decode defensively, cap the length.
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // keep the raw value
  }
  return decoded.slice(0, max);
}

export function getRequestMeta(request: Request): RequestMeta {
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "127.0.0.1";
  const rawCountry = headerText(request, "cf-ipcountry", 8)?.toUpperCase() ?? null;
  // Two-character codes as `request.cf.country` gave them: ISO 3166 plus "T1" (Tor). "XX" means
  // unknown and is treated as no country.
  const country =
    rawCountry && /^[A-Z][A-Z0-9]$/.test(rawCountry) && rawCountry !== "XX" ? rawCountry : null;
  const asnText = headerText(request, "x-vora-asn", 12);
  const asn = asnText && /^\d{1,10}$/.test(asnText) ? Number(asnText) : null;
  return {
    ip,
    ipPrefix: ipPrefix(ip),
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 512),
    country,
    region: headerText(request, "cf-region", 128),
    city: headerText(request, "cf-ipcity", 128),
    asn: asn !== null && asn > 0 ? asn : null,
  };
}

/** Short human label for a user agent, e.g. "Chrome on macOS". Heuristic, display only. */
export function describeUserAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown OS";
  return `${browser} on ${os}`;
}

export function describeLocation(meta: Pick<RequestMeta, "city" | "country">): string {
  return [meta.city, meta.country].filter(Boolean).join(", ") || "Unknown location";
}
