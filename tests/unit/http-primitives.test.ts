import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginRequest, LEGACY_REDIRECTS } from "~/.server/kernel/app";
import { applySecurityHeaders, buildCsp, isPrivatePath } from "~/.server/kernel/headers";
import { maintenancePage, unavailablePage } from "~/.server/kernel/pages";
import { parseCookies, serializeCookie } from "~/.server/lib/cookies";
import { AppError, errors, statusOf, toErrorEnvelope } from "~/.server/lib/errors";
import { describeUserAgent, getRequestMeta, ipPrefix } from "~/.server/lib/request-meta";
import { createLogger, describeError, redact } from "~/.server/observability/logger";
import { isMaintenanceExempt } from "~/.server/services/maintenance";

describe("cookies", () => {
  it("defaults to HttpOnly, Secure, SameSite=Lax, Path=/", () => {
    expect(serializeCookie("s", "abc")).toBe("s=abc; Path=/; HttpOnly; Secure; SameSite=Lax");
  });

  it("expires cookies explicitly when max-age is zero", () => {
    const c = serializeCookie("s", "", { maxAgeSeconds: 0 });
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("refuses names or values that could inject attributes", () => {
    expect(() => serializeCookie("s", "abc; Domain=evil.example")).toThrow();
    expect(() => serializeCookie("s", "a\r\nSet-Cookie: x=1")).toThrow();
    expect(() => serializeCookie("bad name", "v")).toThrow();
  });

  it("parses the first value for each name and ignores junk", () => {
    const parsed = parseCookies("a=1; b=2; a=3; junk; =x; c=");
    expect(parsed.get("a")).toBe("1");
    expect(parsed.get("b")).toBe("2");
    expect(parsed.get("c")).toBe("");
    expect(parsed.has("junk")).toBe(false);
  });
});

describe("security headers and CSP", () => {
  const base = {
    nonce: "n0nce",
    isHtml: true,
    pathname: "/",
    productionLike: true,
    devServer: false,
    requestId: "req-1",
  };

  it("builds a strict nonce-based CSP", () => {
    const csp = buildCsp("abc123", { upgradeInsecure: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(buildCsp("x", { upgradeInsecure: false })).not.toContain("upgrade-insecure-requests");
  });

  it("applies the baseline headers in production", () => {
    const res = applySecurityHeaders(
      new Response("<p>x</p>", { headers: { "Content-Type": "text/html", Server: "leaky" } }),
      base,
    );
    const h = res.headers;
    expect(h.get("Content-Security-Policy")).toContain("'nonce-n0nce'");
    expect(h.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Permissions-Policy")).toContain("camera=()");
    expect(h.get("X-Request-Id")).toBe("req-1");
    expect(h.get("Server")).toBeNull();
    expect(h.get("X-Robots-Tag")).toBeNull(); // public production page stays indexable
  });

  it("uses report-only CSP under the dev server and noindex outside production", () => {
    const res = applySecurityHeaders(
      new Response("x", { headers: { "Content-Type": "text/html" } }),
      {
        ...base,
        productionLike: false,
        devServer: true,
      },
    );
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain("nonce-n0nce");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("keeps private areas out of caches and search engines", () => {
    for (const pathname of [
      "/admin",
      "/admin/users",
      "/account/security",
      "/api/v1/status",
      "/login",
    ]) {
      const res = applySecurityHeaders(new Response("x"), { ...base, pathname, isHtml: false });
      expect(res.headers.get("X-Robots-Tag"), pathname).toBe("noindex, nofollow");
      expect(res.headers.get("Cache-Control"), pathname).toMatch(/no-store/);
    }
  });

  it("matches private prefixes on path boundaries only", () => {
    expect(isPrivatePath("/admin")).toBe(true);
    expect(isPrivatePath("/admin/x")).toBe(true);
    expect(isPrivatePath("/administrators-guide")).toBe(false);
    expect(isPrivatePath("/accountability")).toBe(false);
    expect(isPrivatePath("/work")).toBe(false);
  });
});

describe("CSRF origin gate", () => {
  const post = (headers: Record<string, string>) =>
    new Request("https://vorawebsites.store/api/v1/enquiries", { method: "POST", headers });

  it("accepts same-origin browser requests", () => {
    expect(isSameOriginRequest(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(post({ origin: "https://vorawebsites.store" }))).toBe(true);
  });

  it("rejects cross-site and look-alike origins", () => {
    expect(isSameOriginRequest(post({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "https://vorawebsites.store.evil.example" }))).toBe(
      false,
    );
    expect(isSameOriginRequest(post({ origin: "http://vorawebsites.store" }))).toBe(false);
    expect(isSameOriginRequest(post({ origin: "null" }))).toBe(false);
    expect(isSameOriginRequest(post({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(post({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("rejects header-less requests that carry cookies (ambient credentials)", () => {
    expect(isSameOriginRequest(post({ cookie: "vora_session=x" }))).toBe(false);
    expect(isSameOriginRequest(post({}))).toBe(true); // no browser, no credentials
  });
});

describe("errors", () => {
  it("maps codes to statuses", () => {
    expect(statusOf(errors.validation({ a: "b" }))).toBe(422);
    expect(statusOf(errors.unauthenticated())).toBe(401);
    expect(statusOf(errors.forbidden())).toBe(403);
    expect(statusOf(errors.notFound())).toBe(404);
    expect(statusOf(errors.rateLimited())).toBe(429);
    expect(statusOf(new AppError("csrf_rejected"))).toBe(403);
    expect(statusOf(new Error("boom"))).toBe(500);
  });

  it("never leaks internal details into the public envelope", () => {
    const secretish = new Error("D1_ERROR: password=hunter2 at users.password_hash");
    const envelope = toErrorEnvelope(secretish, "req-9");
    expect(envelope).toEqual({
      error: {
        code: "internal_error",
        message: "Something went wrong on our side.",
        requestId: "req-9",
      },
    });
    const withInternal = new AppError("forbidden", { internal: { permission: "users.manage" } });
    expect(JSON.stringify(toErrorEnvelope(withInternal))).not.toContain("users.manage");
    expect(toErrorEnvelope(errors.validation({ email: "Bad" })).error.fields).toEqual({
      email: "Bad",
    });
  });
});

describe("request metadata", () => {
  it("trusts CF-Connecting-IP and ignores X-Forwarded-For", () => {
    const meta = getRequestMeta(
      new Request("https://x.test/", {
        headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" },
      }),
    );
    expect(meta.ip).toBe("203.0.113.9");
    expect(meta.ipPrefix).toBe("203.0.113.0/24");
  });

  it("truncates IPv6 to /48 and labels user agents", () => {
    expect(ipPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(
      describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Safari/605.1"),
    ).toBe("Safari on iOS");
    expect(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0"),
    ).toBe("Edge on Windows");
  });
});

describe("structured logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts sensitive keys at any depth", () => {
    const out = redact({
      user: { email: "a@b.co", password: "pw", nested: { apiKey: "k", sessionToken: "t" } },
      headers: { cookie: "vora_session=x", authorization: "Bearer y" },
      code: "123456",
      requestId: "req-1",
      status: 200,
      list: [{ secret: "s" }],
    }) as Record<string, never>;
    const text = JSON.stringify(out);
    for (const leaked of ["pw", '"k"', '"t"', "vora_session=x", "Bearer y", "123456", '"s"']) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain("req-1");
    expect(text).toContain("a@b.co");
  });

  it("filters by level and emits JSON objects", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ requestId: "r" }, "warn");
    logger.info("hidden");
    logger.error("shown", { token: "abc" });
    expect(log).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    const line = err.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(line).toMatchObject({
      level: "error",
      msg: "shown",
      requestId: "r",
      token: "[redacted]",
    });
  });

  it("describes errors without provider payloads", () => {
    const d = describeError(new AppError("forbidden", { internal: { permission: "x" } }));
    expect(d.errorName).toBe("AppError");
    expect(d.errorCode).toBe("forbidden");
  });
});

describe("maintenance, legacy routes and kernel pages", () => {
  it("keeps health, sign-in and static assets reachable during maintenance", () => {
    for (const p of ["/api/health", "/api/health/ready", "/login", "/login/verify", "/logout"]) {
      expect(isMaintenanceExempt(p), p).toBe(true);
    }
    for (const p of ["/", "/contact", "/api/v1/enquiries", "/loginx", "/admin"]) {
      expect(isMaintenanceExempt(p), p).toBe(false);
    }
  });

  it("redirects legacy Mark4 URLs to internal pages without loops", () => {
    for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
      expect(to.startsWith("/") && !to.startsWith("//")).toBe(true);
      expect(LEGACY_REDIRECTS[to]).toBeUndefined();
      expect(from).not.toBe(to);
    }
  });

  it("escapes the admin-provided maintenance message", () => {
    const html = maintenancePage('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(unavailablePage("<id>")).toContain("&lt;id&gt;");
    expect(html).not.toContain("<script");
  });
});
