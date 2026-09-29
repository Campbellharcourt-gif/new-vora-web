import { timingSafeEqual } from "node:crypto";
import { TRUSTED_CLIENT_HEADERS } from "../../app/.server/lib/request-meta";

/**
 * Request trust at the origin (Railway migration R5, §4.4 and §5.3). The path is
 * visitor → Cloudflare → Railway's edge → this process (plain HTTP on $PORT).
 *
 * 1. **Origin authentication.** A Cloudflare Transform Rule sets `X-Vora-Origin-Auth` to a secret on
 *    every request. In staging and production anything without the right value is refused (403),
 *    so a request that bypasses Cloudflare (straight to Railway's edge) can neither reach the app
 *    nor forge `CF-Connecting-IP`. The comparison is constant-time and the header is removed
 *    before the application sees the request. Only Railway's deploy health check path is exempt,
 *    and it reveals nothing. This cannot be switched off in staging or production: the server
 *    refuses to start there without a 32+ character secret.
 * 2. **Cloudflare Access (staging).** When configured, the `Cf-Access-Jwt-Assertion` JWT must be
 *    signed by the team's published keys (RS256), carry the application's audience and the team
 *    as issuer, and be within its validity window. Cloudflare documents this check as required
 *    for a public origin.
 * 3. **The public URL** is rebuilt from `APP_ORIGIN` plus the path and query. `Host`,
 *    `X-Forwarded-Proto` and an absolute request-target are ignored, so the CSRF check
 *    (`Origin === url.origin`), redirects and cookies behave exactly as they did on Workers.
 * 4. **Client headers.** Behind a valid origin-auth header, Cloudflare's own headers
 *    (`CF-Connecting-IP`, `CF-IPCountry`, location, the ASN header, `CF-Ray`) are kept. Where
 *    origin authentication is not in force (development, tests) they are deleted and
 *    `CF-Connecting-IP` is set to the socket address — nothing a client sends is trusted.
 *    `X-Forwarded-For` is never used for security decisions (unchanged policy).
 */

export const ORIGIN_AUTH_HEADER = "x-vora-origin-auth";
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
/** Railway's deploy health check — the only path exempt from origin auth and Access. */
export const LIVE_HEALTH_PATH = "/api/health/live";
export const MIN_ORIGIN_SECRET_LENGTH = 32;

export interface TrustConfig {
  appOrigin: string;
  /** True in staging and production; always on there. */
  enforceOriginAuth: boolean;
  originAuthSecret: string | null;
  access: AccessVerifier | null;
}

export type TrustDecision =
  | { kind: "allow"; request: Request; path: string }
  | { kind: "deny"; status: 403 | 503; reason: string; path: string };

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Compare equal-length buffers only; a length mismatch still costs one comparison.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** `::ffff:203.0.113.5` → `203.0.113.5`; undefined → loopback. */
export function normaliseSocketAddress(address: string | undefined): string {
  if (!address) return "127.0.0.1";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped?.[1] ?? address;
}

/** Path and query of whatever the client sent, as a string starting with "/". */
export function pathAndQuery(requestUrl: string): string {
  const url = new URL(requestUrl, "http://placeholder.invalid");
  const path = url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`;
  return `${path}${url.search}`;
}

export async function trustRequest(
  incoming: Request,
  socketAddress: string | undefined,
  config: TrustConfig,
): Promise<TrustDecision> {
  const relative = pathAndQuery(incoming.url);
  const publicUrl = new URL(relative, config.appOrigin);
  const path = publicUrl.pathname;
  const exempt =
    path === LIVE_HEALTH_PATH && (incoming.method === "GET" || incoming.method === "HEAD");

  const headers = new Headers(incoming.headers);
  const presented = headers.get(ORIGIN_AUTH_HEADER);
  headers.delete(ORIGIN_AUTH_HEADER);

  let authenticated = false;
  if (config.enforceOriginAuth && !exempt) {
    const secret = config.originAuthSecret;
    if (!secret || secret.length < MIN_ORIGIN_SECRET_LENGTH) {
      return { kind: "deny", status: 503, reason: "origin_auth_not_configured", path };
    }
    if (!presented || !safeEqual(presented, secret)) {
      return { kind: "deny", status: 403, reason: "origin_auth", path };
    }
    authenticated = true;
  }

  if (config.access && !exempt) {
    const verdict = await config.access.verify(headers.get(ACCESS_JWT_HEADER));
    if (verdict !== "valid") {
      return {
        kind: "deny",
        status: verdict === "keys_unavailable" ? 503 : 403,
        reason: `access_${verdict}`,
        path,
      };
    }
  }

  if (!authenticated) {
    // Nothing a client sends about itself is trusted without origin authentication.
    for (const name of TRUSTED_CLIENT_HEADERS) headers.delete(name);
    headers.set("cf-connecting-ip", normaliseSocketAddress(socketAddress));
  }

  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  const request = new Request(publicUrl, {
    method: incoming.method,
    headers,
    ...(hasBody ? { body: incoming.body, duplex: "half" } : {}),
    signal: incoming.signal,
    redirect: "manual",
  } as RequestInit);
  return { kind: "allow", request, path };
}

// --- Cloudflare Access JWT (staging) ------------------------------------------------------

export type AccessVerdict =
  | "valid"
  | "missing"
  | "malformed"
  | "bad_signature"
  | "wrong_audience"
  | "wrong_issuer"
  | "expired"
  | "not_yet_valid"
  | "unknown_key"
  | "keys_unavailable";

export interface AccessVerifier {
  verify(token: string | null): Promise<AccessVerdict>;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface AccessOptions {
  /** e.g. "vora.cloudflareaccess.com" (with or without https://). */
  teamDomain: string;
  /** The Access application's AUD tag. */
  audience: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** How long fetched keys are trusted before a refresh. */
  keyTtlMs?: number;
  leewaySeconds?: number;
}

/**
 * Verifies Access JWTs against the team's published keys
 * (`https://<team>/cdn-cgi/access/certs`), cached for `keyTtlMs`; an unknown key id triggers at
 * most one refresh per minute (key rotation). Fails closed: no keys → no entry.
 */
export class CloudflareAccessVerifier implements AccessVerifier {
  readonly issuer: string;
  private readonly certsUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly keyTtlMs: number;
  private readonly leeway: number;
  private keys = new Map<string, CryptoKey>();
  private fetchedAt = 0;
  private lastRefreshAttempt = 0;

  constructor(private readonly options: AccessOptions) {
    const domain = options.teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error("Invalid Access team domain");
    if (!options.audience) throw new Error("Access audience is required");
    this.issuer = `https://${domain}`;
    this.certsUrl = `${this.issuer}/cdn-cgi/access/certs`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.keyTtlMs = options.keyTtlMs ?? 60 * 60 * 1000;
    this.leeway = options.leewaySeconds ?? 60;
  }

  private async refresh(): Promise<boolean> {
    this.lastRefreshAttempt = this.now();
    try {
      const res = await this.fetchImpl(this.certsUrl, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return false;
      const body = (await res.json()) as { keys?: Jwk[] };
      const next = new Map<string, CryptoKey>();
      for (const jwk of body.keys ?? []) {
        if (jwk.kty !== "RSA" || !jwk.kid || !jwk.n || !jwk.e) continue;
        const key = await crypto.subtle.importKey(
          "jwk",
          { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
        next.set(jwk.kid, key);
      }
      if (next.size === 0) return false;
      this.keys = next;
      this.fetchedAt = this.now();
      return true;
    } catch {
      return false;
    }
  }

  private async keyFor(kid: string): Promise<CryptoKey | "unknown_key" | "keys_unavailable"> {
    const stale = this.now() - this.fetchedAt > this.keyTtlMs;
    if (this.keys.size === 0 || stale) {
      if (!(await this.refresh()) && this.keys.size === 0) return "keys_unavailable";
    }
    let key = this.keys.get(kid);
    if (!key && this.now() - this.lastRefreshAttempt > 60_000) {
      await this.refresh();
      key = this.keys.get(kid);
    }
    return key ?? "unknown_key";
  }

  async verify(token: string | null): Promise<AccessVerdict> {
    if (!token) return "missing";
    const parts = token.split(".");
    if (parts.length !== 3) return "malformed";
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);
    if (!header || !payload) return "malformed";
    if (header.alg !== "RS256" || typeof header.kid !== "string") return "malformed";
    const key = await this.keyFor(header.kid);
    if (typeof key === "string") return key;
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    let ok = false;
    try {
      ok = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        base64UrlToBytes(signaturePart),
        signed,
      );
    } catch {
      ok = false;
    }
    if (!ok) return "bad_signature";
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(this.options.audience)) return "wrong_audience";
    if (payload.iss !== this.issuer) return "wrong_issuer";
    const nowSeconds = Math.floor(this.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp + this.leeway <= nowSeconds)
      return "expired";
    if (typeof payload.nbf === "number" && payload.nbf - this.leeway > nowSeconds) {
      return "not_yet_valid";
    }
    if (typeof payload.iat === "number" && payload.iat - this.leeway > nowSeconds) {
      return "not_yet_valid";
    }
    return "valid";
  }
}

/** A minimal response for refused requests: no detail, no caching, no sniffing. */
export function denyResponse(status: 403 | 503): Response {
  return new Response(status === 403 ? "Forbidden\n" : "Service unavailable\n", {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
