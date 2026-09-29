import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { completeCode, credentials, signIn } from "./support";

/**
 * The Phase 2 rebuild (docs/VORA-DESIGN-SYSTEM.md): self-hosted type, content that never waits
 * for motion, the menu dialog and its no-JavaScript fallback, the reduced-motion version, focus
 * after navigation, the switched-off assistant, and axe on every public page, both motion modes
 * and each portal area (§13 "How it's verified").
 */

async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test.describe("design system — type, motion and navigation", () => {
  test("type is self-hosted: Archivo loads from /assets and nothing is fetched off-site", async ({
    page,
    baseURL,
  }) => {
    const offSite: string[] = [];
    const fonts: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== new URL(baseURL ?? "http://localhost:5173").origin) offSite.push(url.href);
      if (request.resourceType() === "font") fonts.push(url.pathname);
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.fonts.check("16px Archivo"))).toBe(true);
    expect(fonts.length).toBeGreaterThan(0);
    for (const path of fonts) expect(path).toMatch(/^\/assets\/.+\.woff2$/);
    expect(offSite).toEqual([]);
  });

  test("content never waits for motion: the first shot is visible at load", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    expect(await h1.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    // Anything already on screen was marked revealed before arming, so nothing is hidden.
    const hiddenInView = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>("#main [data-reveal]")).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top < innerHeight && r.bottom > 0 && !el.classList.contains("is-in");
        }).length,
    );
    expect(hiddenInView).toBe(0);
  });

  test("reduced motion arms nothing", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/services");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#main")).not.toHaveClass(/v-armed/);
    await context.close();
  });

  test("the header marks the current section; the CTA marks /contact", async ({ page }) => {
    await page.goto("/work");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Work" })).toHaveAttribute("aria-current", "page");
    await page.goto("/contact");
    await expect(nav.getByRole("link", { name: "Start a project" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("after a client-side navigation, focus moves to the new page's h1", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Services" })
      .click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("the assistant has no entry point while it is switched off (D8)", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByRole("button", { name: "Ask VORA" })).toHaveCount(0);
  });
});

test.describe("design system — the menu below 1024 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("is a modal dialog: focus moves in, Esc closes, focus returns to Menu", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const button = page.getByRole("button", { name: "Menu" });
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Work/ })).toBeFocused();
    await expect(page.locator("#main")).toHaveAttribute("inert", "");
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(page.locator("#main")).not.toHaveAttribute("inert", "");
  });

  test("choosing a destination closes it and navigates", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Menu" }).click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("link", { name: /Careers/ })
      .click();
    await expect(page).toHaveURL(/\/careers$/);
    await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  });

  test("works without JavaScript (the server-rendered <details> menu)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
      baseURL,
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("summary", { hasText: "Menu" }).click();
    await page
      .getByRole("link", { name: /Partners/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/partners$/);
    await context.close();
  });
});

test.describe("design system — accessibility across the site", () => {
  for (const path of [
    "/work",
    "/services",
    "/partners",
    "/careers",
    "/terms",
    "/privacy",
    "/cookies",
  ]) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      await page.goto(path);
      expect(await axe(page)).toEqual([]);
    });
  }

  test("the reduced-motion version passes too (Home, Contact)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", baseURL });
    const page = await context.newPage();
    for (const path of ["/", "/contact"]) {
      await page.goto(path);
      expect(await axe(page), path).toEqual([]);
    }
    await context.close();
  });

  test("member and account areas (Mist workspace)", async ({ page }) => {
    const { email, password } = credentials("member");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/member$/);
    for (const path of ["/member", "/account", "/account/security"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await axe(page), path).toEqual([]);
    }
  });

  test("admin area (Mist workspace), including the drawer below 1024 px", async ({
    page,
  }, testInfo) => {
    // One Owner sign-in per run: sign-in codes have a 60 s resend cooldown per account (and 5 an
    // hour), and the other specs already use the admin and staff accounts. With
    // E2E_BROWSERS=all the WebKit/Firefox projects cover the same pages signed in as a member.
    // biome-ignore lint/suspicious/noSkippedTests: deliberate — one Owner sign-in per run
    test.skip(testInfo.project.name !== "desktop", "runs once (desktop project)");
    await signIn(page, "owner");
    await completeCode(page, "owner");
    await expect(page).toHaveURL(/\/admin$/);
    for (const path of ["/admin", "/admin/enquiries", "/admin/users", "/admin/system"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await axe(page), path).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Enquiries" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});
