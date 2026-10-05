import { expect, test } from "@playwright/test";
import { signIn } from "./support";

/** Each portal belongs to its account type; admin pages refuse portal accounts (real UI). */
test.describe("portal isolation", () => {
  test("a client reaches the client portal only", async ({ page }) => {
    await signIn(page, "client");
    await expect(page).toHaveURL(/\/client$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your projects");
    for (const path of ["/admin", "/admin/clients", "/member"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(403);
    }
  });

  test("a member reaches the member area only", async ({ page }) => {
    await signIn(page, "member");
    await expect(page).toHaveURL(/\/member$/);
    for (const path of [
      "/admin/engagements",
      "/client",
      "/client/projects/eng_01J00000000000000000000000",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(403);
    }
  });
});
