import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * CP-2.1 · A3 — the production build in PRODUCTION MODE over HTTPS (playwright.https.config.ts).
 * Secure cookies and HSTS only exist in production mode on https, so the plain-http suite cannot
 * see them. Uses the `*.https@vora.test` users created by scripts/https-server.mjs.
 */

const BASE = "https://localhost:8443";
const HSTS = "max-age=63072000; includeSubDomains; preload";
const SESSION = "__Host-vora_session";

function member(): { email: string; password: string } {
  const file = join(process.cwd(), ".wrangler", "https-state", "users.json");
  const users = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    { email: string; password: string }
  >;
  if (!users.member) throw new Error("No member in .wrangler/https-state/users.json");
  return users.member;
}

async function signInAsMember(page: Page) {
  const { email, password } = member();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/member$/);
}

test("pages and API responses carry HSTS; HTML gets a CSP that upgrades insecure requests", async ({
  request,
}) => {
  for (const path of ["/", "/contact", "/login", "/status"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const h = res.headers();
    expect(h["strict-transport-security"], path).toBe(HSTS);
    expect(h["content-security-policy"], path).toContain("upgrade-insecure-requests");
    expect(h["content-security-policy-report-only"], path).toBeUndefined();
  }
  const api = await request.get("/api/health");
  expect(api.status()).toBe(200);
  expect(api.headers()["strict-transport-security"]).toBe(HSTS);
});

test("public pages are indexable in production; private areas are noindex and never stored", async ({
  request,
}) => {
  for (const path of ["/", "/services", "/contact"]) {
    expect((await request.get(path)).headers()["x-robots-tag"], path).toBeUndefined();
  }
  for (const path of ["/login", "/api/health"]) {
    const h = (await request.get(path)).headers();
    expect(h["x-robots-tag"], path).toBe("noindex, nofollow");
    expect(h["cache-control"], path).toMatch(/no-store/);
  }
});

test("development-only endpoints do not exist in production mode", async ({ request }) => {
  expect((await request.get("/api/dev/mailbox")).status()).toBe(404);
  expect((await request.get("/setup")).status()).toBe(404); // no SETUP_TOKEN configured
});

test("static assets are served with nosniff", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];
  expect(asset, "a hashed script asset on the home page").toBeTruthy();
  const res = await request.get(asset as string);
  expect(res.status()).toBe(200);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the session cookie set over HTTPS is __Host-: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain", async ({
  request,
}) => {
  const { email, password } = member();
  const res = await request.post("/login", {
    headers: { origin: BASE, "sec-fetch-site": "same-origin" },
    form: { email, password },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe("/member");
  const cookies = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  const session = cookies.find((c) => c.startsWith(`${SESSION}=`));
  expect(session, "a __Host- session cookie").toBeTruthy();
  const attributes = (session as string)
    .split(";")
    .slice(1)
    .map((a) => a.trim().toLowerCase());
  expect(attributes).toEqual(
    expect.arrayContaining(["secure", "httponly", "samesite=lax", "path=/"]),
  );
  expect(attributes.some((a) => a.startsWith("domain="))).toBe(false);
  // The plain-http name is never used on https.
  expect(cookies.some((c) => c.startsWith("vora_session="))).toBe(false);
});

test("a real browser keeps the __Host- cookie host-only and hidden from scripts", async ({
  page,
  context,
}) => {
  await signInAsMember(page);
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === SESSION);
  expect(session).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    domain: "localhost", // host-only: no leading dot, no Domain attribute
  });
  expect(cookies.some((c) => c.name === "vora_session")).toBe(false);
  expect(await page.evaluate(() => document.cookie)).not.toContain("vora_session");

  // Signed-in pages and their data URLs are private and never stored.
  for (const path of ["/member", "/member.data"]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["cache-control"], path).toBe("private, no-store");
    expect(res.headers()["strict-transport-security"], path).toBe(HSTS);
  }

  // Signing out removes it.
  await page.goto("/account");
  await page
    .getByRole("button", { name: /sign out/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/login\?signedout=1$/);
  expect((await context.cookies()).some((c) => c.name === SESSION)).toBe(false);
});

test("cross-site form posts are refused in production mode", async ({ request }) => {
  const { email, password } = member();
  const res = await request.post("/login", {
    headers: { origin: "https://evil.example" },
    form: { email, password },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
  // An http:// Origin for this same host cannot be tested through `wrangler dev`: its local proxy
  // rewrites every same-host URL in request headers to the upstream origin, whatever the scheme.
  // The scheme comparison itself is covered by tests/unit/http-primitives.test.ts (CSRF gate).
});
