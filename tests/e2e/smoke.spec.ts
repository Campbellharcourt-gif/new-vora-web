import { expect, test } from "@playwright/test";
import { watchPage } from "./support";

const PUBLIC_PAGES = [
  "/",
  "/work",
  "/services",
  "/our-story",
  "/partners",
  "/careers",
  "/contact",
  "/status",
  "/terms",
  "/privacy",
  "/cookies",
];

test.describe("public site (production build in workerd)", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} renders with one h1, a title and no script errors`, async ({ page }) => {
      const problems = watchPage(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page).toHaveTitle(/VORA/);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(problems).toEqual([]);
    });
  }

  test("unknown paths get the designed 404 with a real 404 status", async ({ page }) => {
    const response = await page.goto("/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist.");
  });

  test("legacy Mark4 URLs redirect permanently", async ({ request }) => {
    const res = await request.get("/plans", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toMatch(/\/services$/);
  });

  test("every script carries the per-request CSP nonce", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    const scripts = await page
      .locator("script")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLScriptElement).nonce));
    expect(scripts.length).toBeGreaterThan(0);
    for (const value of scripts) expect(value).toBe(nonce);
    const headers = response?.headers() ?? {};
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  test("the site hydrates: client-side navigation works without a full reload", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __marker: boolean }).__marker = true;
    });
    await page.getByRole("link", { name: "Contact" }).first().click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start a project");
    expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(
      true,
    );
  });

  test("robots.txt and sitemap.xml are served", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/User-agent/i);
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");
  });

  test("public status reports components without internals", async ({ request }) => {
    const res = await request.get("/api/v1/status");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { overall: string; components: { name: string }[] };
    expect(body.components.length).toBe(4);
    expect(JSON.stringify(body)).not.toMatch(/latency|detail|secret/i);
  });
});
