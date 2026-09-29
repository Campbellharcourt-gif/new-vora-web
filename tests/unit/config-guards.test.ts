import { describe, expect, it } from "vitest";
import { sessionCookie, sessionCookieName } from "~/.server/auth/sessions";
import { getConfig, type WorkerEnv } from "~/.server/config/env";
import type { ServerContext } from "~/.server/context";
import { failureFrom, safeNext } from "~/.server/guards";
import { AppError, errors } from "~/.server/lib/errors";
import { FORM_TOKEN_POLICY, issueFormToken, verifyFormToken } from "~/.server/services/form-token";

const SECRET = "s".repeat(48);

function env(overrides: Partial<Record<keyof WorkerEnv, string>> = {}): WorkerEnv {
  return {
    APP_ENV: "development",
    APP_ORIGIN: "http://localhost:5173",
    AUTH_SECRET: SECRET,
    EMAIL_TRANSPORT: "capture",
    ...overrides,
  } as unknown as WorkerEnv;
}

const PROD = {
  APP_ENV: "production",
  APP_ORIGIN: "https://vorawebsites.store",
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "re_live_key",
  TURNSTILE_SITE_KEY: "0x4AAAAAAA-site",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret",
} as const;

function configError(e: WorkerEnv): string[] {
  try {
    getConfig(e);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return ((error as AppError).internal?.invalidKeys as string[]) ?? [];
  }
  return [];
}

describe("environment configuration", () => {
  it("accepts a valid development and production configuration", () => {
    expect(getConfig(env()).isProductionLike).toBe(false);
    const prod = getConfig(env(PROD));
    expect(prod.isProductionLike).toBe(true);
    expect(prod.origin).toBe("https://vorawebsites.store");
    expect(prod.authSecrets).toEqual([SECRET]);
  });

  it("fails closed on a short AUTH_SECRET and reports keys, never values", () => {
    const keys = configError(env({ AUTH_SECRET: "tooshort" }));
    expect(keys.join()).toContain("AUTH_SECRET");
    expect(keys.join()).not.toContain("tooshort");
  });

  it("refuses unsafe production settings", () => {
    expect(configError(env({ ...PROD, APP_ORIGIN: "http://vorawebsites.store" })).join()).toContain(
      "APP_ORIGIN",
    );
    expect(configError(env({ ...PROD, EMAIL_TRANSPORT: "capture" })).join()).toContain(
      "EMAIL_TRANSPORT",
    );
    expect(configError(env({ ...PROD, TURNSTILE_SECRET_KEY: "" })).join()).toContain(
      "TURNSTILE_SECRET_KEY",
    );
    expect(
      configError(
        env({ ...PROD, TURNSTILE_SITE_KEY: "REPLACE_WITH_PRODUCTION_TURNSTILE_SITE_KEY" }),
      ).join(),
    ).toContain("TURNSTILE_SITE_KEY");
    expect(configError(env({ ...PROD, RESEND_API_KEY: "" })).join()).toContain("RESEND_API_KEY");
    expect(configError(env({ SETUP_TOKEN: "short" })).join()).toContain("SETUP_TOKEN");
    expect(configError(env({ APP_ENV: "prod" })).join()).toContain("APP_ENV");
  });

  it("supports secret rotation with AUTH_SECRET_PREVIOUS", () => {
    const previous = "p".repeat(40);
    expect(getConfig(env({ AUTH_SECRET_PREVIOUS: previous })).authSecrets).toEqual([
      SECRET,
      previous,
    ]);
    expect(getConfig(env({ AUTH_SECRET_PREVIOUS: "  " })).authSecrets).toEqual([SECRET]);
  });

  it("uses a __Host- Secure cookie on HTTPS and a plain one on local HTTP", () => {
    const prod = { config: getConfig(env(PROD)) };
    expect(sessionCookieName(prod)).toBe("__Host-vora_session");
    const cookie = sessionCookie(prod, "t".repeat(43), 12 * 3_600_000);
    expect(cookie).toMatch(
      /^__Host-vora_session=t{43}; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(cookie).not.toContain("Domain");
    const local = { config: getConfig(env()) };
    expect(sessionCookieName(local)).toBe("vora_session");
    expect(sessionCookie(local, "t".repeat(43), 1000)).not.toContain("Secure");
  });
});

describe("signed form tokens", () => {
  function ctxAt(now: number, secrets?: Partial<Record<keyof WorkerEnv, string>>) {
    return {
      clock: { now: () => now },
      config: getConfig(env(secrets)),
    } as unknown as ServerContext;
  }
  const T0 = 1_790_000_000_000;

  it("accepts a token after the minimum age and returns its nonce", async () => {
    const token = await issueFormToken(ctxAt(T0), "enquiry");
    const result = await verifyFormToken(ctxAt(T0 + 5_000), "enquiry", token);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("flags bot-speed submissions, expiry, tampering and cross-form reuse", async () => {
    const token = await issueFormToken(ctxAt(T0), "enquiry");
    expect(await verifyFormToken(ctxAt(T0 + 500), "enquiry", token)).toEqual({
      ok: false,
      reason: "too_fast",
    });
    expect(
      await verifyFormToken(ctxAt(T0 + FORM_TOKEN_POLICY.maxAge + 1), "enquiry", token),
    ).toEqual({
      ok: false,
      reason: "expired",
    });
    const [issued, nonce, mac] = token.split(".") as [string, string, string];
    const forgedTime = `${Number(issued) - 60_000}.${nonce}.${mac}`;
    expect(await verifyFormToken(ctxAt(T0 + 5_000), "enquiry", forgedTime)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await verifyFormToken(ctxAt(T0 + 5_000), "application", token)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await verifyFormToken(ctxAt(T0 + 5_000), "enquiry", "garbage")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyFormToken(ctxAt(T0 + 5_000), "enquiry", 42)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("keeps working across an AUTH_SECRET rotation", async () => {
    const oldSecret = "o".repeat(40);
    const token = await issueFormToken(ctxAt(T0, { AUTH_SECRET: oldSecret }), "enquiry");
    const rotated = ctxAt(T0 + 5_000, { AUTH_SECRET: SECRET, AUTH_SECRET_PREVIOUS: oldSecret });
    expect(await verifyFormToken(rotated, "enquiry", token)).toMatchObject({ ok: true });
    expect(await verifyFormToken(ctxAt(T0 + 5_000), "enquiry", token)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("route guards", () => {
  it("only accepts same-site relative redirect targets", () => {
    expect(safeNext("/admin/enquiries?status=received")).toBe("/admin/enquiries?status=received");
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "admin",
      "/ok\r\nSet-Cookie: x=1",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(bad), String(bad)).toBe("/account");
    }
  });

  it("turns expected service errors into form data and rethrows the rest", () => {
    expect(failureFrom(errors.validation({ email: "Bad email" }))).toEqual({
      status: 422,
      message: "Some details need attention.",
      fields: { email: "Bad email" },
    });
    expect(failureFrom(errors.rateLimited())).toMatchObject({ status: 429 });
    for (const accessError of [errors.forbidden(), errors.notFound(), errors.unauthenticated()]) {
      try {
        failureFrom(accessError);
        expect.unreachable();
      } catch (thrown) {
        expect((thrown as { init?: { status?: number } }).init?.status).toBe(accessError.status);
      }
    }
    const unknown = new Error("db exploded");
    expect(() => failureFrom(unknown)).toThrow(unknown);
  });
});
