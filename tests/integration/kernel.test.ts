import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { WorkerEnv } from "~/.server/config/env";
import { createKernel, LEGACY_REDIRECTS } from "~/.server/kernel/app";
import {
  actorFor,
  call,
  createUser,
  db,
  ORIGIN,
  putSetting,
  SAME_ORIGIN,
  schema,
  testEnv,
} from "../support/helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = { ...SAME_ORIGIN, "content-type": "application/json" };

function envWith(overrides: Partial<Record<keyof WorkerEnv, string>>): WorkerEnv {
  return { ...testEnv, ...overrides } as WorkerEnv;
}

async function csrfEvents() {
  return (
    await db
      .select()
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.type, "csrf.rejected"))
      .all()
  ).length;
}

describe("HTTP kernel", () => {
  it("adds security headers and a request ID to API and page responses", async () => {
    const api = await call("/api/health");
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ status: "ok" });
    expect(api.headers.get("X-Request-Id")).toMatch(UUID);
    expect(api.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(api.headers.get("X-Frame-Options")).toBe("DENY");
    expect(api.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(api.headers.get("Cache-Control")).toBe("no-store");
    expect(api.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const page = await call("/");
    const csp = page.headers.get("Content-Security-Policy") ?? "";
    const nonce = /'nonce-([A-Za-z0-9_-]{22})'/.exec(csp)?.[1];
    expect(nonce).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    const again = await call("/");
    expect(again.headers.get("Content-Security-Policy")).not.toContain(`'nonce-${nonce}'`);
  });

  it("uses a well-formed cf-ray as the request ID and ignores anything else", async () => {
    const ray = await call("/api/health", { headers: { "cf-ray": "8c1f2e3d4a5b6c7d-SYD" } });
    expect(ray.headers.get("X-Request-Id")).toBe("8c1f2e3d4a5b6c7d-SYD");
    const junk = await call("/api/health", { headers: { "cf-ray": "<script>alert(1)</script>" } });
    expect(junk.headers.get("X-Request-Id")).toMatch(UUID);
  });

  it("answers unknown API routes with the JSON error envelope", async () => {
    const res = await call("/api/v9/nothing-here");
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toBe(res.headers.get("X-Request-Id"));
  });

  it("blocks cross-site state-changing requests and records them", async () => {
    const before = await csrfEvents();
    const evil = await call("/api/v1/enquiries", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { error: { code: string } }).error.code).toBe("csrf_rejected");

    const crossSitePage = await call("/contact", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
      body: "a=1",
    });
    expect(crossSitePage.status).toBe(403);
    expect(await crossSitePage.text()).toContain("blocked for your security");

    const ambient = await call("/api/v1/account/sessions/revoke-others", {
      method: "POST",
      headers: { cookie: "vora_session=x" },
    });
    expect(ambient.status).toBe(403);
    expect(await csrfEvents()).toBe(before + 3);

    // Webhooks authenticate by signature, not origin (endpoint arrives in a later phase → 404).
    const webhook = await call("/api/webhooks/resend", {
      method: "POST",
      headers: { origin: "https://api.resend.com" },
      body: "{}",
    });
    expect(webhook.status).toBe(404);
  });

  it("parses API bodies strictly", async () => {
    const plain = await call("/api/v1/enquiries", {
      method: "POST",
      headers: { ...SAME_ORIGIN, "content-type": "text/plain" },
      body: "hello",
    });
    expect(plain.status).toBe(415);
    const broken = await call("/api/v1/enquiries", {
      method: "POST",
      headers: json,
      body: "{not json",
    });
    expect(broken.status).toBe(400);
    const huge = await call("/api/v1/enquiries", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ fields: { message: "x".repeat(40_000) }, formToken: "t" }),
    });
    expect(huge.status).toBe(413);
    const shape = await call("/api/v1/enquiries", { method: "POST", headers: json, body: "[]" });
    expect(shape.status).toBe(422);
  });

  it("redirects legacy Mark4 URLs permanently", async () => {
    for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
      const res = await call(from);
      expect(res.status, from).toBe(301);
      expect(new URL(res.headers.get("Location") ?? "", ORIGIN).pathname).toBe(to);
    }
  });

  it("exposes the development mailbox only outside production-like environments", async () => {
    expect((await call("/api/dev/mailbox")).status).toBe(200);
  });
});

describe("maintenance mode", () => {
  it("serves a maintenance page while keeping health, sign-in and staff access", async () => {
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    const member = await actorFor((await createUser({ roles: ["member"] })).id);
    await putSetting("maintenance", { enabled: true, message: "Back at 3pm <b>AEST</b>" });
    try {
      const page = await call("/");
      expect(page.status).toBe(503);
      expect(page.headers.get("Retry-After")).toBe("600");
      const html = await page.text();
      expect(html).toContain("Back at 3pm &lt;b&gt;AEST&lt;/b&gt;");
      const api = await call("/api/v1/status");
      expect(api.status).toBe(503);
      expect(((await api.json()) as { error: { code: string } }).error.code).toBe("maintenance");
      expect((await call("/api/health")).status).toBe(200);
      expect((await call("/login")).status).toBe(200);
      expect((await call("/admin", { token: staff.token })).status).toBe(200);
      expect((await call("/account", { token: member.token })).status).toBe(503);
    } finally {
      await putSetting("maintenance", { enabled: false, message: null });
    }
    expect((await call("/")).status).toBe(200);
  });

  it("can be forced from the environment at deploy time", async () => {
    const res = await call("/", { env: envWith({ MAINTENANCE_MODE: "on" }) });
    expect(res.status).toBe(503);
  });
});

describe("configuration failures and production headers", () => {
  it("fails closed with a generic 503 that leaks no configuration", async () => {
    const broken = envWith({ AUTH_SECRET: "short-secret-value" });
    const api = await call("/api/v1/status", { env: broken });
    expect(api.status).toBe(503);
    const text = await api.text();
    expect(text).toContain("service_unavailable");
    expect(text).not.toContain("AUTH_SECRET");
    expect(text).not.toContain("short-secret-value");
    const page = await call("/", { env: broken });
    expect(page.status).toBe(503);
    expect(page.headers.get("content-type")).toContain("text/html");
  });

  it("sends HSTS, upgrade-insecure-requests and indexable public pages in staging/production", async () => {
    const staging = envWith({
      APP_ENV: "staging",
      APP_ORIGIN: "https://staging.vorawebsites.store",
      EMAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_test_key",
      TURNSTILE_SITE_KEY: "0x4AAAAAAA-site",
      TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret",
    });
    const page = await call("/", { env: staging });
    expect(page.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(page.headers.get("Content-Security-Policy")).toContain("upgrade-insecure-requests");
    expect(page.headers.get("X-Robots-Tag")).toBeNull();
    expect((await call("/admin", { env: staging })).headers.get("X-Robots-Tag")).toBe(
      "noindex, nofollow",
    );
    expect((await call("/api/dev/mailbox", { env: staging })).status).toBe(404);
  });

  it("renders a generic 500 for unexpected page errors without internals", async () => {
    const broken = createKernel({
      renderPage: async () => {
        throw new Error("secret stack detail: D1 password=hunter2");
      },
    });
    const ctx = createExecutionContext();
    const res = await broken.fetch(
      new Request(`${ORIGIN}/work`, { headers: { "cf-connecting-ip": "192.0.2.1" } }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("stack");
    expect(html).toContain(res.headers.get("X-Request-Id") ?? "missing");
  });
});
