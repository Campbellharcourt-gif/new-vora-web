import { pagePath } from "../lib/paths";

/** Security headers and Content-Security-Policy construction (pure, unit-tested). */

export const PRIVATE_PREFIXES = [
  "/admin",
  "/account",
  "/client",
  "/member",
  "/login",
  "/logout",
  "/setup",
  "/invite",
  "/reset-password",
  "/forgot-password",
  "/verify-email",
  "/register",
  "/preview",
  "/api",
] as const;

/** True for private areas and for their single-fetch data URLs (`/account.data`). */
export function isPrivatePath(pathname: string): boolean {
  const path = pagePath(pathname);
  return PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function buildCsp(nonce: string, options: { upgradeInsecure: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (options.upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export interface HeaderOptions {
  nonce: string;
  isHtml: boolean;
  pathname: string;
  productionLike: boolean;
  /** Vite dev server: CSP is report-only so HMR's injected scripts keep working. */
  devServer: boolean;
  requestId: string;
}

/** Applies security headers to a response. Returns a new Response (originals may be immutable). */
export function applySecurityHeaders(response: Response, o: HeaderOptions): Response {
  const res = new Response(response.body, response);
  const h = res.headers;
  h.set("X-Request-Id", o.requestId);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
  );
  if (o.productionLike)
    h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  if (o.isHtml) {
    const csp = buildCsp(o.nonce, { upgradeInsecure: o.productionLike });
    h.set(o.devServer ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", csp);
  }
  if (isPrivatePath(o.pathname)) {
    h.set("X-Robots-Tag", "noindex, nofollow");
    if (!h.has("Cache-Control") || !/no-store|private/.test(h.get("Cache-Control") ?? "")) {
      h.set("Cache-Control", "private, no-store");
    }
  }
  if (!o.productionLike) h.set("X-Robots-Tag", "noindex, nofollow");
  h.delete("X-Powered-By");
  h.delete("Server");
  return res;
}
