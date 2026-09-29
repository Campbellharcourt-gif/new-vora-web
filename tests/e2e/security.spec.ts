import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, type Browser, expect, request, test } from "@playwright/test";
import { scanClientBundle, secretValuesFrom } from "../../scripts/security-scan";

/**
 * Security verification of the PRODUCTION BUILD (served by workerd via `vite preview`), from the
 * perspective of an authorised tester. Uses its own user set (`*.sec@vora.test`) so sign-in
 * codes, cooldowns and rate limits never interfere with the other suites. Nothing here touches a
 * remote system.
 */

type Role = "owner" | "admin" | "manager" | "staff" | "client" | "member";
type Who = Role | "anon";
type StorageState = Awaited<ReturnType<Awaited<ReturnType<Browser["newContext"]>>["storageState"]>>;

const BASE = "http://localhost:5173";
const ROLES: Role[] = ["owner", "admin", "manager", "staff", "client", "member"];
const PRIVILEGED = new Set<Role>(["owner", "admin", "manager", "staff"]);
const SAME_ORIGIN = { origin: BASE, "sec-fetch-site": "same-origin" };

function credentials(role: Role): { email: string; password: string } {
  const file = join(process.cwd(), ".wrangler", "e2e-state", "users-sec.json");
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    { email: string; password: string }
  >;
  const found = all[role];
  if (!found) throw new Error(`No security-suite credentials for ${role}`);
  return found;
}

async function latestCode(api: APIRequestContext, email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await api.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        const body = (await res.json()) as { messages: { subject: string; text: string }[] };
        const message = body.messages.find((m) => /sign-in code/.test(m.subject));
        code = message ? /\b(\d{6})\b/.exec(message.text)?.[1] : undefined;
        return code;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return code as string;
}

/** Signs a role in through the real UI (with the emailed code where required). */
async function signInAs(browser: Browser, role: Role): Promise<StorageState> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  const { email, password } = credentials(role);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (PRIVILEGED.has(role)) {
    await expect(page).toHaveURL(/\/login\/verify/);
    await page.getByLabel("Code").fill(await latestCode(page.request, email));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
  const state = await context.storageState();
  await context.close();
  return state;
}

const sessions = new Map<Role, StorageState>();
const clients = new Map<Who, APIRequestContext>();

async function as(who: Who): Promise<APIRequestContext> {
  const existing = clients.get(who);
  if (existing) return existing;
  const created = await request.newContext({
    baseURL: BASE,
    ...(who === "anon" ? {} : { storageState: sessions.get(who) }),
  });
  clients.set(who, created);
  return created;
}

function sessionToken(who: Role): string {
  const cookie = sessions.get(who)?.cookies.find((c) => c.name === "vora_session");
  if (!cookie) throw new Error(`no session for ${who}`);
  return cookie.value;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  for (const role of ROLES) sessions.set(role, await signInAs(browser, role));
});

test.afterAll(async () => {
  for (const client of clients.values()) await client.dispose();
});

// ---------------------------------------------------------------------------------------------
// Authorisation: every protected route, every role, straight HTTP requests (no UI hiding).
// ---------------------------------------------------------------------------------------------

type Expect = 200 | 403 | "login";
const ALL_SIGNED_IN: Record<Role, Expect> = {
  owner: 200,
  admin: 200,
  manager: 200,
  staff: 200,
  client: 200,
  member: 200,
};
const MATRIX: Record<string, Record<Who, Expect>> = {
  "/admin": {
    anon: "login",
    member: 403,
    client: 403,
    staff: 200,
    manager: 200,
    admin: 200,
    owner: 200,
  },
  "/admin/enquiries": {
    anon: "login",
    member: 403,
    client: 403,
    staff: 200,
    manager: 200,
    admin: 200,
    owner: 200,
  },
  "/admin/users": {
    anon: "login",
    member: 403,
    client: 403,
    staff: 403,
    manager: 200,
    admin: 200,
    owner: 200,
  },
  "/admin/system": {
    anon: "login",
    member: 403,
    client: 403,
    staff: 403,
    manager: 403,
    admin: 200,
    owner: 200,
  },
  "/account": { anon: "login", ...ALL_SIGNED_IN },
  "/account/security": { anon: "login", ...ALL_SIGNED_IN },
  "/client": {
    anon: "login",
    client: 200,
    member: 403,
    staff: 403,
    manager: 403,
    admin: 403,
    owner: 403,
  },
  "/member": {
    anon: "login",
    member: 200,
    client: 403,
    staff: 403,
    manager: 403,
    admin: 403,
    owner: 403,
  },
};

test("route authorisation matrix: page requests", async () => {
  const mismatches: string[] = [];
  for (const [path, expected] of Object.entries(MATRIX)) {
    for (const who of ["anon", ...ROLES] as Who[]) {
      const res = await (await as(who)).get(path, { maxRedirects: 0 });
      const want = expected[who];
      const got = res.status();
      if (want === "login") {
        const location = res.headers().location ?? "";
        if (got !== 302 || location !== `/login?next=${encodeURIComponent(path)}`) {
          mismatches.push(`${who} ${path}: ${got} → ${location}`);
        }
      } else if (got !== want) {
        mismatches.push(`${who} ${path}: expected ${want}, got ${got}`);
      }
    }
  }
  expect(mismatches).toEqual([]);
});

test("route authorisation matrix: single-fetch data requests leak nothing", async () => {
  // Client-side navigation fetches `<path>.data`; the same guards must apply there.
  for (const [path, expected] of Object.entries(MATRIX)) {
    for (const who of ["anon", "member", "staff"] as Who[]) {
      const res = await (await as(who)).get(`${path}.data`, { maxRedirects: 0 });
      const body = await res.text();
      if (expected[who] === 200) {
        expect(res.status(), `${who} ${path}.data`).toBe(200);
      } else {
        expect(res.status(), `${who} ${path}.data`).not.toBe(200);
        // A refused response may carry the requester's OWN layout data (their name and email,
        // which they are entitled to), but nothing about anyone else and no records.
        const others = ROLES.filter((r) => r !== who).map((r) => credentials(r).email);
        for (const email of others) expect(body, `${who} ${path}.data`).not.toContain(email);
        expect(body, `${who} ${path}.data`).not.toMatch(/passwordHash|password_hash|enq_|usr_/);
      }
    }
  }
});

test("private pages and their data endpoints are never cacheable or indexable", async () => {
  const member = await as("member");
  for (const path of ["/account", "/account.data", "/account/security.data", "/member.data"]) {
    const res = await member.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    expect(res.headers()["cache-control"] ?? "", path).toMatch(/no-store/);
    expect(res.headers()["x-robots-tag"] ?? "", path).toMatch(/noindex/);
  }
  const admin = await as("admin");
  for (const path of ["/admin.data", "/admin/users.data", "/admin/system.data"]) {
    const res = await admin.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    expect(res.headers()["cache-control"] ?? "", path).toMatch(/no-store/);
  }
});

test("actions re-check permissions server-side and refused actions change nothing", async () => {
  const target = `refused-${Date.now()}@example.test`;
  for (const who of ["staff", "member", "client"] as Role[]) {
    const res = await (await as(who)).post("/admin/users", {
      headers: SAME_ORIGIN,
      form: { intent: "invite", email: target, roleKeys: "staff", name: "Nope" },
      maxRedirects: 0,
    });
    expect(res.status(), who).toBe(403);
  }
  const anon = await (await as("anon")).post("/admin/users", {
    headers: SAME_ORIGIN,
    form: { intent: "invite", email: target, roleKeys: "staff" },
    maxRedirects: 0,
  });
  expect(anon.status()).toBe(302);
  expect(anon.headers().location).toMatch(/^\/login\?next=/);
  const mailbox = (await (
    await as("anon")
  )
    .get(`/api/dev/mailbox?to=${encodeURIComponent(target)}`)
    .then((r) => r.json())) as {
    messages: unknown[];
  };
  expect(mailbox.messages).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// CSRF: every state-changing endpoint refuses cross-site requests, even with a valid session.
// ---------------------------------------------------------------------------------------------

const ACTION_PATHS = [
  "/login",
  "/login.data",
  "/login/verify",
  "/login/recovery",
  "/forgot-password",
  "/reset-password/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "/invite/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "/setup",
  "/logout",
  "/logout.data",
  "/contact",
  "/account/security",
  "/admin/users",
  "/admin/enquiries/enq_01J8Z6XG0000000000000000AA",
  "/api/v1/enquiries",
  "/api/v1/account/sessions/revoke-others",
];

test("cross-site POSTs are refused on every action, with or without a session", async () => {
  const admin = await as("admin");
  const anon = await as("anon");
  for (const path of ACTION_PATHS) {
    for (const [label, client] of [
      ["admin", admin],
      ["anon", anon],
    ] as const) {
      const evilOrigin = await client.post(path, {
        headers: { origin: "https://evil.example" },
        form: { intent: "revoke-others" },
        maxRedirects: 0,
      });
      expect(evilOrigin.status(), `${label} evil origin ${path}`).toBe(403);
      const crossSite = await client.post(path, {
        headers: { "sec-fetch-site": "cross-site" },
        form: { intent: "revoke-others" },
        maxRedirects: 0,
      });
      expect(crossSite.status(), `${label} cross-site ${path}`).toBe(403);
    }
  }
  // Credentialed request with no Origin/Sec-Fetch-Site at all (e.g. old browser or plugin).
  const bare = await request.newContext({ baseURL: BASE });
  const res = await bare.post("/account/security", {
    headers: { cookie: `vora_session=${sessionToken("admin")}` },
    form: { intent: "revoke-others" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
  await bare.dispose();
  // The admin session survived every attempt above.
  expect((await admin.get("/api/v1/account/sessions")).status()).toBe(200);
});

// ---------------------------------------------------------------------------------------------
// Sessions, redirects and enumeration.
// ---------------------------------------------------------------------------------------------

test("a planted session cookie is never adopted (fixation) and GET cannot sign out", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: BASE });
  const planted = "P".repeat(43);
  await context.addCookies([{ name: "vora_session", value: planted, url: BASE }]);
  const page = await context.newPage();
  const { email, password } = credentials("member");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/member$/);
  const issued = (await context.cookies()).find((c) => c.name === "vora_session")?.value;
  expect(issued).toBeTruthy();
  expect(issued).not.toBe(planted);

  const withPlanted = await request.newContext({ baseURL: BASE });
  expect(
    (
      await withPlanted.get("/api/v1/account/sessions", {
        headers: { cookie: `vora_session=${planted}` },
      })
    ).status(),
  ).toBe(401);
  await withPlanted.dispose();

  // Logout by GET (e.g. an <img src="/logout">) must not end the session.
  await page.goto("/logout");
  expect((await page.request.get("/api/v1/account/sessions")).status()).toBe(200);
  // A real sign-out is a same-origin POST, and it kills the token server-side.
  await page.goto("/account");
  await page
    .getByRole("button", { name: /sign out/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/login\?signedout=1$/);
  const replay = await request.newContext({ baseURL: BASE });
  expect(
    (
      await replay.get("/api/v1/account/sessions", {
        headers: { cookie: `vora_session=${issued}` },
      })
    ).status(),
  ).toBe(401);
  await replay.dispose();
  await context.close();
});

test("sign-in redirects never leave the site (open redirect)", async () => {
  const member = await as("member");
  for (const next of [
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "http:evil.example",
    "/\r\nSet-Cookie: x=1",
  ]) {
    const res = await member.get(`/login?next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    const location = res.headers().location ?? "";
    expect(res.status(), next).toBe(302);
    expect(location, next).toMatch(/^\/(?![/\\])/);
    expect(location, next).not.toMatch(/evil|javascript|[\r\n]/i);
  }
  const ok = await member.get(`/login?next=${encodeURIComponent("/account/security")}`, {
    maxRedirects: 0,
  });
  expect(ok.headers().location).toBe("/account/security");
});

test("password reset answers identically for known and unknown emails", async ({ browser }) => {
  const known = credentials("client").email;
  const unknown = `nobody-${Date.now()}@example.test`;
  const outcomes: { status: number; text: string }[] = [];
  for (const email of [known, unknown]) {
    const context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Send reset link" }).click(),
    ]);
    await expect(page.getByText(/If an account exists for that email/)).toBeVisible();
    outcomes.push({
      status: response.status(),
      text: (await page.locator("main").innerText()).trim(),
    });
    await context.close();
  }
  expect(outcomes[1]).toEqual(outcomes[0]);
});

test("setup is closed once an Owner exists, and bad links reveal nothing", async () => {
  const anon = await as("anon");
  expect((await anon.get("/setup")).status()).toBe(404);
  const setupPost = await anon.post("/setup", {
    headers: SAME_ORIGIN,
    form: {
      setupToken: "guess",
      name: "x",
      email: "x@example.test",
      password: "a long password 123",
    },
    maxRedirects: 0,
  });
  expect(setupPost.status()).toBe(404);
  const reset = await anon.get("/reset-password/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  expect(await reset.text()).toContain("This link has expired");
  const invite = await anon.get("/invite/not-a-token");
  const inviteHtml = await invite.text();
  expect(inviteHtml).toContain("This invitation isn");
  expect(inviteHtml).not.toMatch(/@vora\.test|@example\.test/);
});

// ---------------------------------------------------------------------------------------------
// Stored XSS: hostile enquiry → staff views it in the admin.
// ---------------------------------------------------------------------------------------------

test("hostile enquiry content is shown as text in the admin, never executed", async ({
  browser,
}) => {
  const payloadName = `Mallory <img src=x onerror="window.__xss=1">`;
  const payloadCompany = `"><script>window.__xss=2</script>`;
  const payloadMessage = `Hello <svg/onload=window.__xss=3> — please review our project brief carefully.`;

  const visitor = await browser.newContext({ baseURL: BASE });
  const form = await visitor.newPage();
  await form.goto("/contact");
  await form.getByLabel("Your name").fill(payloadName);
  await form.getByLabel("Email").fill(`mallory-${Date.now()}@example.test`);
  await form.getByLabel("Company or organisation").fill(payloadCompany);
  await form.getByRole("checkbox", { name: "Website or digital platform" }).check();
  await form.getByRole("radio", { name: "Flexible" }).check();
  await form.getByLabel("About the project").fill(payloadMessage);
  await form.getByRole("checkbox", { name: /privacy notice/ }).check();
  await form.waitForTimeout(3500);
  await form.getByRole("button", { name: "Send enquiry" }).click();
  await expect(form.getByRole("heading", { level: 1 })).toHaveText("Thank you.");
  const reference = (await form.locator("strong").filter({ hasText: /^VR-/ }).textContent()) ?? "";
  await visitor.close();

  const staff = await browser.newContext({ baseURL: BASE, storageState: sessions.get("staff") });
  const page = await staff.newPage();
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await page.goto("/admin/enquiries");
  await expect(page.getByText(payloadName)).toBeVisible();
  await page.getByRole("link", { name: reference }).click();
  await expect(page.getByText(payloadCompany).first()).toBeVisible();
  await expect(page.getByText(payloadMessage).first()).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
  expect(await page.locator('img[src="x"], svg[onload]').count()).toBe(0);
  expect(await page.locator("script:not([nonce])").count()).toBe(0);
  expect(dialogs).toEqual([]);
  await staff.close();
});

// ---------------------------------------------------------------------------------------------
// Browser controls and exposure.
// ---------------------------------------------------------------------------------------------

test("baseline security headers on every kind of Worker response", async () => {
  const anon = await as("anon");
  const member = await as("member");
  const cases: [string, APIRequestContext, number][] = [
    ["/", anon, 200],
    ["/definitely-missing", anon, 404],
    ["/admin", member, 403],
    ["/admin", anon, 302],
    ["/plans", anon, 301],
    ["/api/health", anon, 200],
    ["/api/nothing", anon, 404],
    ["/api/v1/account/sessions", anon, 401],
    ["/robots.txt", anon, 200],
    ["/sitemap.xml", anon, 200],
    ["/member.data", member, 200],
  ];
  for (const [path, client, status] of cases) {
    const res = await client.get(path, { maxRedirects: 0 });
    const h = res.headers();
    expect(res.status(), path).toBe(status);
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["x-request-id"], path).toBeTruthy();
    expect(h.server, path).toBeUndefined();
    expect(h["x-powered-by"], path).toBeUndefined();
    expect(h["access-control-allow-origin"], path).toBeUndefined();
    if ((h["content-type"] ?? "").includes("text/html")) {
      expect(h["content-security-policy"] ?? "", path).toMatch(
        /'nonce-[^']+'.*frame-ancestors 'none'/,
      );
    }
  }
});

test("static assets are served with nosniff", async () => {
  const anon = await as("anon");
  const html = await (await anon.get("/")).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(
    (m) => m[1] as string,
  );
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets.slice(0, 6)) {
    const res = await anon.get(asset);
    expect(res.status(), asset).toBe(200);
    expect(res.headers()["x-content-type-options"], asset).toBe("nosniff");
  }
});

test("no cross-origin API access is granted (CORS)", async () => {
  const anon = await as("anon");
  const get = await anon.get("/api/v1/status", { headers: { origin: "https://evil.example" } });
  expect(get.headers()["access-control-allow-origin"]).toBeUndefined();
  const preflight = await anon.fetch("/api/v1/enquiries", {
    method: "OPTIONS",
    headers: {
      origin: "https://evil.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  expect(preflight.headers()["access-control-allow-origin"]).toBeUndefined();
  expect(preflight.headers()["access-control-allow-credentials"]).toBeUndefined();
});

test("server files, secrets and source are not reachable over HTTP", async () => {
  const anon = await as("anon");
  for (const path of [
    "/.dev.vars",
    "/wrangler.json",
    "/index.js",
    "/server/index.js",
    "/build/server/index.js",
    "/package.json",
    "/.git/config",
    "/_headers",
    "/.wrangler/e2e-state/users.json",
    "/app/.server/config/env.ts",
    "/assets/../server/index.js",
  ]) {
    const res = await anon.get(path, { maxRedirects: 0 });
    const body = await res.text();
    expect([301, 302, 404], path).toContain(res.status());
    expect(body, path).not.toMatch(/AUTH_SECRET|SETUP_TOKEN|"password"|argon2id|createKernel/);
  }
});

test("client bundles contain no secrets, server code or source maps", async () => {
  // The build this server is running (e2e:server builds right before starting it).
  const root = join(process.cwd(), "build", "client");
  const jsFiles = readdirSync(join(root, "assets")).filter((f) => f.endsWith(".js"));
  expect(jsFiles.length).toBeGreaterThan(5);
  const secrets = secretValuesFrom([join(process.cwd(), "build", "server", ".dev.vars")]);
  expect(secrets.length).toBeGreaterThan(0); // the throwaway AUTH_SECRET and SETUP_TOKEN
  expect(scanClientBundle(root, secrets)).toEqual([]);
});
