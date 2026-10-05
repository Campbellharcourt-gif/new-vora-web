import { expect, type Page, test } from "@playwright/test";

/** Latest link with this path prefix in mail sent to an address (local capture mailbox). */
async function mailedLink(page: Page, email: string, path: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        const body = (await res.json()) as { messages: { text: string }[] };
        const pattern = new RegExp(`https?://[^\\s]+${path}/[A-Za-z0-9_-]+`);
        link = body.messages.map((m) => pattern.exec(m.text)?.[0]).find(Boolean);
        return link;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return new URL(link as string).pathname;
}

test.describe("create an account (Client or Member)", () => {
  test("sign-in offers account creation", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "New to VORA?" })).toBeVisible();
    await expect(page.getByText("Create an account as a Client or Member.")).toBeVisible();
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create an account");
    // Only the two self-service account types exist, each described.
    await expect(page.getByRole("radio")).toHaveCount(2);
    await expect(page.getByRole("radio", { name: "Client" })).toHaveAccessibleDescription(
      "For VORA clients who need access to their projects, updates, files and account information.",
    );
    await expect(page.getByRole("radio", { name: "Member" })).toHaveAccessibleDescription(
      "For VORA members who need access to member resources and their account.",
    );
    await expect(
      page.locator("main").getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
  });

  test("a client registers, confirms by email, sets a password and lands in the portal", async ({
    page,
  }) => {
    const email = `e2e-reg-${Date.now()}@example.test`;
    await page.goto("/register");
    await page.getByRole("radio", { name: "Client" }).check();
    await page.getByLabel("Your name").fill("Robin Client");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("checkbox", { name: /Privacy Policy/ }).check();
    await page.waitForTimeout(3500); // the signed form token rejects bot-speed submissions
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");

    await page.goto(await mailedLink(page, email, "/verify-email"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your password");
    await page.getByLabel("Password", { exact: true }).fill("a long passphrase for e2e 2026");
    await page.getByLabel("Confirm password").fill("a long passphrase for e2e 2026");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/client\?welcome=1$/);
    await expect(page.getByText("Account created")).toBeVisible();

    // A client never reaches the admin workspace.
    const denied = await page.goto("/admin");
    expect(denied?.status()).toBe(403);
  });

  test("a forged account type is rejected server-side", async ({ page }) => {
    await page.goto("/register");
    const token = await page.locator('input[name="formToken"]').inputValue();
    await page.waitForTimeout(3500);
    const res = await page.request.post("/register", {
      headers: { origin: new URL(page.url()).origin },
      form: {
        formToken: token,
        accountType: "admin",
        name: "Mallory",
        email: `e2e-forged-${Date.now()}@example.test`,
        consent: "on",
      },
    });
    expect(res.status()).toBe(400);
  });
});
