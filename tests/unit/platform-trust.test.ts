import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "~/.server/kernel/app";
import { getRequestMeta } from "~/.server/lib/request-meta";
import {
  CloudflareAccessVerifier,
  denyResponse,
  normaliseSocketAddress,
  pathAndQuery,
  type TrustConfig,
  trustRequest,
} from "../../server/platform/trust";

/**
 * Railway migration R5 (§4.4, §5.3, §13.2 items 3–4): request trust at the origin. Cloudflare is in
 * front; Railway's edge is publicly reachable, so the application must tell Cloudflare-originated
 * traffic from a direct hit, never trust a client-supplied header, and see the true public URL.
 */

const APP_ORIGIN = "https://staging.vorawebsites.store";
const SECRET = "origin-auth-secret-0123456789-abcdefghij";

function config(overrides: Partial<TrustConfig> = {}): TrustConfig {
  return {
    appOrigin: APP_ORIGIN,
    enforceOriginAuth: true,
    originAuthSecret: SECRET,
    access: null,
    ...overrides,
  };
}

function incoming(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  // What @hono/node-server builds from the socket: http://<Host header><path>.
  return new Request(`http://internal.railway:3000${path}`, init);
}

describe("origin authentication (staging and production)", () => {
  it("refuses a request without the origin-auth header (a direct hit on Railway)", async () => {
    const decision = await trustRequest(incoming("/"), "10.0.0.5", config());
    expect(decision).toMatchObject({ kind: "deny", status: 403, reason: "origin_auth" });
  });

  it("refuses a wrong or truncated secret, compared in constant time", async () => {
    for (const presented of ["wrong", SECRET.slice(0, -1), `${SECRET}x`, ""]) {
      const decision = await trustRequest(
        incoming("/", { headers: { "x-vora-origin-auth": presented } }),
        "10.0.0.5",
        config(),
      );
      expect(decision.kind, presented).toBe("deny");
    }
  });

  it("ignores a forged CF-Connecting-IP: without the secret the request never reaches the app", async () => {
    const decision = await trustRequest(
      incoming("/login", { headers: { "cf-connecting-ip": "203.0.113.7" } }),
      "10.0.0.5",
      config(),
    );
    expect(decision.kind).toBe("deny");
  });

  it("with the secret, keeps Cloudflare's headers and removes the secret before the app sees it", async () => {
    const decision = await trustRequest(
      incoming("/login", {
        headers: {
          "x-vora-origin-auth": SECRET,
          "cf-connecting-ip": "203.0.113.7",
          "cf-ipcountry": "AU",
          "cf-ipcity": "Melbourne",
          "x-vora-asn": "13335",
          "cf-ray": "8f0c1a2b3c4d5e6f-SYD",
        },
      }),
      "10.0.0.5",
      config(),
    );
    expect(decision.kind).toBe("allow");
    if (decision.kind !== "allow") return;
    expect(decision.request.headers.get("x-vora-origin-auth")).toBeNull();
    const meta = getRequestMeta(decision.request);
    expect(meta).toMatchObject({ ip: "203.0.113.7", country: "AU", city: "Melbourne", asn: 13335 });
  });

  it("refuses to serve at all when the secret is missing or short (503, never open)", async () => {
    for (const originAuthSecret of [null, "short"]) {
      const decision = await trustRequest(
        incoming("/", { headers: { "x-vora-origin-auth": "short" } }),
        "10.0.0.5",
        config({ originAuthSecret }),
      );
      expect(decision).toMatchObject({ kind: "deny", status: 503 });
    }
  });

  it("exempts only GET/HEAD /api/health/live (Railway's deploy check), which learns nothing trusted", async () => {
    const live = await trustRequest(
      incoming("/api/health/live", { headers: { "cf-connecting-ip": "203.0.113.7" } }),
      "10.0.0.5",
      config(),
    );
    expect(live.kind).toBe("allow");
    if (live.kind === "allow")
      expect(live.request.headers.get("cf-connecting-ip")).toBe("10.0.0.5");
    for (const [path, method] of [
      ["/api/health/live", "POST"],
      ["/api/health", "GET"],
      ["/api/health/live/", "GET"],
      ["/api/health/live2", "GET"],
    ] as const) {
      const decision = await trustRequest(incoming(path, { method }), "10.0.0.5", config());
      expect(decision.kind, `${method} ${path}`).toBe("deny");
    }
  });
});

describe("development and tests (origin auth not in force)", () => {
  it("replaces client-supplied trusted headers with the socket address", async () => {
    const decision = await trustRequest(
      incoming("/", {
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "cf-ipcountry": "US",
          "x-vora-asn": "64500",
          "cf-ray": "forged",
          "x-forwarded-for": "198.51.100.1",
        },
      }),
      "::ffff:127.0.0.1",
      config({
        enforceOriginAuth: false,
        originAuthSecret: null,
        appOrigin: "http://localhost:5173",
      }),
    );
    expect(decision.kind).toBe("allow");
    if (decision.kind !== "allow") return;
    const h = decision.request.headers;
    expect(h.get("cf-connecting-ip")).toBe("127.0.0.1");
    for (const name of ["cf-ipcountry", "x-vora-asn", "cf-ray"])
      expect(h.get(name), name).toBeNull();
    expect(getRequestMeta(decision.request)).toMatchObject({
      ip: "127.0.0.1",
      country: null,
      asn: null,
    });
  });
});

describe("the public URL is rebuilt from APP_ORIGIN", () => {
  it("Host, X-Forwarded-Proto and X-Forwarded-Host cannot change it", async () => {
    const decision = await trustRequest(
      incoming("/contact?x=1", {
        headers: {
          "x-vora-origin-auth": SECRET,
          host: "evil.example",
          "x-forwarded-proto": "http",
          "x-forwarded-host": "evil.example",
        },
      }),
      "10.0.0.5",
      config(),
    );
    expect(decision.kind).toBe("allow");
    if (decision.kind === "allow") expect(decision.request.url).toBe(`${APP_ORIGIN}/contact?x=1`);
  });

  it("an absolute-form request target keeps only its path and query", () => {
    expect(pathAndQuery("http://other.example:8080/a/b?c=d")).toBe("/a/b?c=d");
    expect(pathAndQuery("http://internal/")).toBe("/");
  });

  it("a same-origin POST passes CSRF although the socket is plain HTTP; a cross-site one does not", async () => {
    const post = async (origin: string) => {
      const decision = await trustRequest(
        incoming("/login", {
          method: "POST",
          headers: { "x-vora-origin-auth": SECRET, origin, "content-type": "text/plain" },
          body: "email=a",
        }),
        "10.0.0.5",
        config(),
      );
      if (decision.kind !== "allow") throw new Error("denied");
      return decision.request;
    };
    const same = await post(APP_ORIGIN);
    expect(isSameOriginRequest(same)).toBe(true);
    expect(await same.text()).toBe("email=a"); // the body survives the rebuild
    expect(isSameOriginRequest(await post("http://staging.vorawebsites.store"))).toBe(false);
    expect(isSameOriginRequest(await post("https://evil.example"))).toBe(false);
  });

  it("normalises IPv4-mapped socket addresses", () => {
    expect(normaliseSocketAddress("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(normaliseSocketAddress("2001:db8::1")).toBe("2001:db8::1");
    expect(normaliseSocketAddress(undefined)).toBe("127.0.0.1");
  });

  it("refusals carry no detail and are never cached", async () => {
    const res = denyResponse(403);
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("Forbidden\n");
  });
});

// --- Cloudflare Access JWT ------------------------------------------------------------------

const TEAM = "vora.cloudflareaccess.com";
const AUD = "3f5c9d2e1b7a4c6d8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d";

function keyPair() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

function jwks(publicKey: KeyObject, kid: string) {
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  return { keys: [{ kid, kty: "RSA", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }] };
}

function jwt(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
) {
  const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = enc({ alg: "RS256", kid: "k1", typ: "JWT", ...header });
  const body = enc(claims);
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString(
    "base64url",
  );
  return `${head}.${body}.${signature}`;
}

const NOW = Date.UTC(2026, 8, 29, 2, 0, 0);
const valid = {
  aud: [AUD],
  iss: `https://${TEAM}`,
  email: "approved.person@example.com",
  iat: NOW / 1000 - 10,
  nbf: NOW / 1000 - 10,
  exp: NOW / 1000 + 3600,
};

function verifier(publicKey: KeyObject, options: { fetchOk?: boolean } = {}) {
  let fetches = 0;
  const v = new CloudflareAccessVerifier({
    teamDomain: TEAM,
    audience: AUD,
    now: () => NOW,
    fetchImpl: (async (url: string) => {
      fetches += 1;
      expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
      if (options.fetchOk === false) throw new Error("network down");
      return new Response(JSON.stringify(jwks(publicKey, "k1")), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { v, fetches: () => fetches };
}

describe("Cloudflare Access JWT validation (staging, D22)", () => {
  const { privateKey, publicKey } = keyPair();

  it("accepts a token signed by the team's key, for this application, within its validity", async () => {
    const { v, fetches } = verifier(publicKey);
    expect(await v.verify(jwt(privateKey, valid))).toBe("valid");
    expect(await v.verify(jwt(privateKey, { ...valid, aud: AUD }))).toBe("valid");
    expect(fetches()).toBe(1); // keys are cached
  });

  it("refuses a wrong audience, a wrong issuer, an expired or not-yet-valid token", async () => {
    const { v } = verifier(publicKey);
    expect(await v.verify(jwt(privateKey, { ...valid, aud: ["another-app"] }))).toBe(
      "wrong_audience",
    );
    expect(
      await v.verify(jwt(privateKey, { ...valid, iss: "https://evil.cloudflareaccess.com" })),
    ).toBe("wrong_issuer");
    expect(await v.verify(jwt(privateKey, { ...valid, exp: NOW / 1000 - 3600 }))).toBe("expired");
    expect(await v.verify(jwt(privateKey, { ...valid, nbf: NOW / 1000 + 3600 }))).toBe(
      "not_yet_valid",
    );
  });

  it("refuses unsigned, re-signed, malformed and missing tokens", async () => {
    const { v } = verifier(publicKey);
    const other = keyPair();
    expect(await v.verify(jwt(other.privateKey, valid))).toBe("bad_signature");
    const [h, b] = jwt(privateKey, valid).split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${b}.`;
    expect(await v.verify(none)).toBe("malformed");
    expect(await v.verify(`${h}.${b}`)).toBe("malformed");
    expect(await v.verify("not-a-jwt")).toBe("malformed");
    expect(await v.verify(null)).toBe("missing");
    const tampered = jwt(privateKey, valid).replace(
      /\.[^.]+\./,
      `.${Buffer.from(JSON.stringify({ ...valid, email: "x@evil" })).toString("base64url")}.`,
    );
    expect(await v.verify(tampered)).toBe("bad_signature");
  });

  it("fails closed when the team's keys cannot be fetched", async () => {
    const { v } = verifier(publicKey, { fetchOk: false });
    expect(await v.verify(jwt(privateKey, valid))).toBe("keys_unavailable");
  });

  it("in the request path: allowed with a valid token, refused otherwise; the deploy check stays exempt", async () => {
    const { v } = verifier(publicKey);
    const cfg = config({ access: v });
    const ok = await trustRequest(
      incoming("/", {
        headers: {
          "x-vora-origin-auth": SECRET,
          "cf-access-jwt-assertion": jwt(privateKey, valid),
        },
      }),
      "10.0.0.5",
      cfg,
    );
    expect(ok.kind).toBe("allow");
    const missing = await trustRequest(
      incoming("/", { headers: { "x-vora-origin-auth": SECRET } }),
      "10.0.0.5",
      cfg,
    );
    expect(missing).toMatchObject({ kind: "deny", status: 403, reason: "access_missing" });
    const live = await trustRequest(incoming("/api/health/live"), "10.0.0.5", cfg);
    expect(live.kind).toBe("allow");
  });

  it("refuses a malformed team domain at configuration time", () => {
    expect(
      () => new CloudflareAccessVerifier({ teamDomain: "evil.example/path?x", audience: AUD }),
    ).toThrow();
    expect(() => new CloudflareAccessVerifier({ teamDomain: TEAM, audience: "" })).toThrow();
  });
});
