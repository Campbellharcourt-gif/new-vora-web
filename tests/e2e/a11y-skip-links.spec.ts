import { expect, type Page, test } from "@playwright/test";
import { credentials } from "./support";

/**
 * The skip link on the sign-in and signed-in (workspace) layouts. The public layout's skip link is
 * covered by a11y.spec.ts ("keyboard users can skip to the main content").
 *
 * In Safari/WebKit's default keyboard mode, Tab leaves ordinary links out, so each skip link has
 * tabindex="0". Without it, the first Tab went to the Email field on /login and to "Sign out" in
 * the workspace (Tab, Enter would have signed the user out). These tests run in every browser
 * project, including WebKit, with `E2E_BROWSERS=all`.
 *
 * The file name sorts before the other specs, so its one sign-in happens before the suites that
 * sign in many times (the sign-in rate limit is per address, 20 a minute).
 */

async function skipToMain(page: Page) {
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText(/skip/i);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(page.locator("main")).toBeVisible();
}

test("sign-in pages: the first Tab reaches the skip link, which moves to the main content", async ({
  page,
}) => {
  await page.goto("/login");
  await skipToMain(page);
});

test("signed-in workspace: the first Tab reaches the skip link, not Sign out", async ({ page }) => {
  const { email, password } = credentials("member");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/member$/);
  // A fresh page load, so Tab starts from the top of the document.
  await page.goto("/member");
  await skipToMain(page);
});
