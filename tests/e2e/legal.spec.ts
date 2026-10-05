import { expect, test } from "@playwright/test";

test.describe("legal pages", () => {
  test("the footer links Terms & Conditions and Privacy Policy", async ({ page }) => {
    await page.goto("/");
    const legal = page.getByRole("contentinfo").getByRole("navigation", { name: "Legal" });
    await expect(legal.getByRole("link")).toHaveText(["Terms & Conditions", "Privacy Policy"]);

    // Client-side navigation lands on the right document each time.
    await legal.getByRole("link", { name: "Terms & Conditions" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms & Conditions");
    await expect(page).toHaveTitle("Terms & Conditions — VORA");
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
  });

  test("an unpublished policy says so plainly and invents nothing", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByText("This page is being finalised.")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("[Draft");
    await expect(page.getByRole("main").getByRole("navigation", { name: "Legal" })).toBeVisible();
  });

  test("sign-in and registration link the Privacy Policy", async ({ page }) => {
    for (const path of ["/login", "/register"]) {
      await page.goto(path);
      await expect(
        page.getByRole("contentinfo").getByRole("link", { name: "Privacy Policy" }),
        path,
      ).toHaveAttribute("href", "/privacy");
    }
  });
});
