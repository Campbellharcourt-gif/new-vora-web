import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/contact", "/login", "/our-story", "/status", "/definitely-not-a-page"];

test.describe("accessibility (axe, WCAG 2.2 A/AA rules)", () => {
  for (const path of PAGES) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const blocking = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      expect(blocking).toEqual([]);
    });
  }

  test("keyboard users can skip to the main content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveText(/skip/i);
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeVisible();
  });
});
