/**
 * Server-derived facts about a request. Only Cloudflare-set headers are trusted for the client
 * IP (`CF-Connecting-IP`); `X-Forwarded-For` is never used for security decisions.
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

type CfProps = { country?: unknown; region?: unknown; city?: unknown; asn?: unknown };

export function getRequestMeta(request: Request): RequestMeta {
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "127.0.0.1";
  const cf = (request as Request & { cf?: CfProps }).cf ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    ip,
    ipPrefix: ipPrefix(ip),
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 512),
    country: str(cf.country),
    region: str(cf.region),
    city: str(cf.city),
    asn: typeof cf.asn === "number" ? cf.asn : null,
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
