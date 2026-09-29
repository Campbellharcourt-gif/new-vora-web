import { expect, test } from "@playwright/test";
import { completeCode, credentials, signIn } from "./support";

test.describe("sign-in and access control (real UI)", () => {
  test("anonymous visitors are sent to sign-in, keeping the destination", async ({ page }) => {
    await page.goto("/admin/enquiries");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fenquiries$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });

  test("wrong passwords get one generic message", async ({ page }) => {
    const { email } = credentials("member");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");
  });

  test("a member signs in without a code and lands in the member area", async ({
    page,
    context,
  }) => {
    await signIn(page, "member");
    await expect(page).toHaveURL(/\/member$/);
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "vora_session");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain("vora_session");
  });

  test("members cannot open the admin workspace", async ({ page }) => {
    await signIn(page, "member");
    await expect(page).toHaveURL(/\/member$/);
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "You don't have access to this.",
    );
  });

  test("staff must enter the emailed code, then reach the admin workspace", async ({ page }) => {
    await signIn(page, "staff", "/admin");
    await completeCode(page, "staff");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Staff lack users.view: the users screen is refused even though admin.access is held.
    const denied = await page.goto("/admin/users");
    expect(denied?.status()).toBe(403);
  });

  test("an admin signs in with a code, sees system status, and signs out server-side", async ({
    page,
    context,
  }) => {
    await signIn(page, "admin");
    await completeCode(page, "admin");
    await expect(page).toHaveURL(/\/admin$/);
    const status = await page.goto("/admin/system");
    expect(status?.status()).toBe(200);
    await expect(page.getByText("database", { exact: false }).first()).toBeVisible();

    const before = (await context.cookies()).find((c) => c.name === "vora_session")?.value;
    expect(before).toBeTruthy();
    await page.goto("/account");
    await page
      .getByRole("button", { name: /sign out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login\?signedout=1$/);
    // The old token no longer works even if replayed.
    const replay = await page.request.get("/api/v1/account/sessions", {
      headers: { cookie: `vora_session=${before}` },
    });
    expect(replay.status()).toBe(401);
  });

  test("a pending (password-only) session cannot reach the workspace", async ({ page }) => {
    await signIn(page, "manager");
    await expect(page).toHaveURL(/\/login\/verify/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    const api = await page.request.get("/api/v1/account/sessions");
    expect(api.status()).toBe(401);
  });
});
