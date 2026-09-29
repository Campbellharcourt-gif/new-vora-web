import { expect, test } from "@playwright/test";

test.describe("enquiry form (real UI → D1 → outbox)", () => {
  test("shows field errors for an empty submission", async ({ page }) => {
    await page.goto("/contact");
    await page.waitForTimeout(3500); // the signed form token rejects bot-speed submissions
    await page.getByRole("button", { name: "Send enquiry" }).click();
    // Error summary (announced) plus inline errors wired to their fields for assistive tech.
    const summary = page.getByRole("alert").first();
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Please confirm you have read the privacy notice.");
    const consent = page.getByRole("checkbox", { name: /privacy notice/ });
    await expect(consent).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await consent.getAttribute("aria-describedby")) ?? "";
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
      "Please confirm you have read the privacy notice.",
    );
    await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start a project");
  });

  test("a complete enquiry is stored, referenced and confirmed", async ({ page, request }) => {
    const email = `e2e-${Date.now()}@example.test`;
    await page.goto("/contact");
    await page.getByLabel("Your name").fill("Jordan Lee");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Company or organisation").fill("Northwind");
    await page.getByLabel("Current website").fill("northwind.example");
    await page.getByRole("checkbox", { name: "Website or digital platform" }).check();
    await page.getByRole("radio", { name: "Flexible" }).check();
    await page
      .getByLabel("About the project")
      .fill("We are planning a new website for our studio and want to talk about scope.");
    await page.getByRole("checkbox", { name: /privacy notice/ }).check();
    await page.waitForTimeout(3500);
    await page.getByRole("button", { name: "Send enquiry" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thank you.");
    const reference = await page.locator("strong").filter({ hasText: /^VR-/ }).textContent();
    expect(reference).toMatch(/^VR-[0-9A-HJKMNP-TV-Z]{6}$/);

    // Confirmation email captured by the local transport, carrying the same reference.
    await expect
      .poll(async () => {
        const res = await request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        const body = (await res.json()) as { messages: { subject: string }[] };
        return body.messages.map((m) => m.subject).join("|");
      })
      .toContain(reference ?? "missing");
  });

  test("cross-site form posts are refused", async ({ request }) => {
    const res = await request.post("/contact", {
      headers: {
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      data: "name=x",
    });
    expect(res.status()).toBe(403);
  });
});
