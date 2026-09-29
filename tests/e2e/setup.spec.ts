import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { latestCode } from "./support";

/**
 * CP-2.1 · A1 — the one-time `/setup` first-Owner flow, end to end, on the PRODUCTION BUILD.
 *
 * `npm run e2e:server` serves the same build from two extra preview servers whose throwaway
 * databases are migrated and seeded but have NO users:
 *   :5174 — the flow in a normal browser (steps 1–7 run in order and share that database)
 *   :5175 — the same flow with JavaScript switched off (a plain HTML form post)
 * The main suite's database (:5173) already has an Owner, so /setup is closed there (covered in
 * security.spec.ts).
 *
 * The setup token is the throwaway value the E2E harness writes into build/server/.dev.vars for
 * this run only; it is never printed.
 */

const SETUP_BASE = "http://localhost:5174";
const NO_JS_BASE = "http://localhost:5175";
const OWNER = { name: "Setup Owner", email: "owner.setup@vora.test" };
// Contains no part of the name, the email or "vora" (all rejected by the password policy).
const OWNER_PASSWORD = "Kettle-Harbour-Lantern-47";

function setupToken(): string {
  const vars = readFileSync(join(process.cwd(), "build", "server", ".dev.vars"), "utf8");
  const token = /^SETUP_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
  if (!token) throw new Error("No setup token in build/server/.dev.vars — run `npm run test:e2e`.");
  return token;
}

async function fillSetup(
  page: Page,
  values: { token: string; name: string; email: string; password: string; confirm?: string },
) {
  await page.getByLabel("Setup token").fill(values.token);
  await page.getByLabel("Your name").fill(values.name);
  await page.getByLabel("Email").fill(values.email);
  await page.getByLabel("Password", { exact: true }).fill(values.password);
  await page.getByLabel("Confirm password").fill(values.confirm ?? values.password);
  await page.getByRole("button", { name: "Create Owner account" }).click();
}

async function hasSession(page: Page): Promise<boolean> {
  return (await page.context().cookies()).some((c) => c.name.endsWith("vora_session"));
}

/** The one-time result page: 10 distinct codes in the ABCDE-12345 format. */
async function expectRecoveryCodes(page: Page): Promise<string[]> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Owner account created");
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  const items = page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem");
  await expect(items).toHaveCount(10);
  const codes = (await items.allInnerTexts()).map((t) => t.trim());
  for (const code of codes) expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  expect(new Set(codes).size).toBe(10);
  return codes;
}

/** Signed in by the setup response itself: httpOnly and SameSite=Lax. */
async function expectSetupSession(page: Page) {
  const session = (await page.context().cookies()).find((c) => c.name.endsWith("vora_session"));
  expect(session, "session cookie set by the setup response").toBeTruthy();
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
}

async function passwordStep(page: Page, next = "/admin") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The Owner is privileged: a password alone never signs them in.
  await expect(page).toHaveURL(/\/login\/verify/);
}

test.describe("first-Owner setup in a normal browser (:5174)", () => {
  test.use({ baseURL: SETUP_BASE });
  test.describe.configure({ mode: "serial" });

  let recoveryCodes: string[] = [];

  test("1 · /setup is open while no Owner exists, and the form is accessible", async ({ page }) => {
    const response = await page.goto("/setup");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create the Owner account");
    await expect(page.getByLabel("Setup token")).toHaveAttribute("type", "password");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(blocking).toEqual([]);
  });

  test("2 · a wrong setup token is refused and creates nothing", async ({ page }) => {
    await page.goto("/setup");
    await fillSetup(page, {
      token: "not-the-setup-token",
      name: OWNER.name,
      email: OWNER.email,
      password: OWNER_PASSWORD,
    });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "You don't have access to this.",
    );
    await expect(page.getByText("You don't have permission to do that.")).toBeVisible();
    expect(await hasSession(page)).toBe(false);
    // Nothing was created: setup is still available.
    expect((await page.goto("/setup"))?.status()).toBe(200);
  });

  test("3 · the server enforces the password rules even with the correct token", async ({
    page,
  }) => {
    const token = setupToken();
    await page.goto("/setup");

    // Contains the email's local part: passes the browser's checks, refused by the server policy.
    await fillSetup(page, {
      token,
      name: OWNER.name,
      email: OWNER.email,
      password: "owner.setup-Harbour-47",
    });
    await expect(page.getByRole("alert")).toContainText(
      "Your password shouldn't contain your email address.",
    );
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await hasSession(page)).toBe(false);

    // Confirmation does not match.
    await fillSetup(page, {
      token,
      name: OWNER.name,
      email: OWNER.email,
      password: OWNER_PASSWORD,
      confirm: `${OWNER_PASSWORD}x`,
    });
    await expect(page.getByRole("alert")).toContainText("The passwords don't match.");
    await expect(page.getByLabel("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(await hasSession(page)).toBe(false);
    expect((await page.goto("/setup"))?.status()).toBe(200);
  });

  test("4 · the correct token creates the Owner, shows the recovery codes once, and signs them in", async ({
    page,
  }) => {
    await page.goto("/setup");
    await fillSetup(page, {
      token: setupToken(),
      name: OWNER.name,
      email: OWNER.email,
      password: OWNER_PASSWORD,
    });
    recoveryCodes = await expectRecoveryCodes(page);
    await expectSetupSession(page);
    expect(await page.evaluate(() => document.cookie)).not.toContain("vora_session");

    await page.getByRole("link", { name: "I've saved my codes — continue" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The Owner holds every permission, including user management.
    expect((await page.goto("/admin/users"))?.status()).toBe(200);
  });

  test("5 · setup closes for good, and the token cannot create a second Owner", async ({
    page,
  }) => {
    const response = await page.goto("/setup");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist.");

    const second = { email: "second.owner@vora.test", password: "Copper-Meadow-Signal-92" };
    const replay = await page.request.post("/setup", {
      headers: { origin: SETUP_BASE, "sec-fetch-site": "same-origin" },
      form: {
        setupToken: setupToken(),
        name: "Second Person",
        email: second.email,
        password: second.password,
        confirmPassword: second.password,
      },
      maxRedirects: 0,
    });
    expect(replay.status()).toBe(404);
    expect(await hasSession(page)).toBe(false);

    // No account was created for the second address.
    await page.goto("/login");
    await page.getByLabel("Email").fill(second.email);
    await page.getByLabel("Password").fill(second.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");
  });

  test("6 · the Owner signs in with password + emailed code", async ({ page }) => {
    await passwordStep(page);
    const code = await latestCode(page.request, OWNER.email);
    await page.getByLabel("Code").fill(code);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect((await page.goto("/admin/users"))?.status()).toBe(200);
  });

  test("7 · a recovery code signs the Owner in exactly once", async ({ page }) => {
    expect(recoveryCodes).toHaveLength(10);
    const [first, second] = recoveryCodes as [string, string];

    // First use: accepted (typed without the dash, lower case — both are normalised).
    await passwordStep(page, "/account");
    await page.getByRole("link", { name: "Use a recovery code instead" }).click();
    await expect(page).toHaveURL(/\/login\/recovery/);
    await page.getByLabel("Recovery code").fill(first.replace("-", "").toLowerCase());
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);
    expect(await hasSession(page)).toBe(true);

    // The Owner is told by email, with the number of codes left.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `/api/dev/mailbox?to=${encodeURIComponent(OWNER.email)}`,
          );
          const body = (await res.json()) as { messages: { subject: string; text: string }[] };
          return body.messages.find((m) => m.subject.includes("A recovery code was used"))?.text;
        },
        { timeout: 10_000 },
      )
      .toContain("You have 9 unused recovery codes left.");

    // Sign out, then try the same code again: refused.
    await page
      .getByRole("button", { name: /sign out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login\?signedout=1$/);
    await passwordStep(page, "/account");
    await page.getByRole("link", { name: "Use a recovery code instead" }).click();
    await page.getByLabel("Recovery code").fill(first);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "That recovery code isn't valid or has already been used.",
    );
    await expect(page).toHaveURL(/\/login\/recovery/);

    // A different, unused code still works.
    await page.getByLabel("Recovery code").fill(second);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
});

test.describe("first-Owner setup with JavaScript switched off (:5175)", () => {
  test.use({ baseURL: NO_JS_BASE, javaScriptEnabled: false });

  test("a plain form post creates the Owner, shows the recovery codes and signs them in", async ({
    page,
  }) => {
    expect((await page.goto("/setup"))?.status()).toBe(200);
    await fillSetup(page, {
      token: setupToken(),
      name: OWNER.name,
      email: OWNER.email,
      password: OWNER_PASSWORD,
    });
    await expectRecoveryCodes(page);
    await expectSetupSession(page);

    // Following the link is an ordinary page load of the server-rendered workspace.
    await page.getByRole("link", { name: "I've saved my codes — continue" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect((await page.goto("/admin/users"))?.status()).toBe(200);
    expect((await page.goto("/setup"))?.status()).toBe(404);
  });
});
