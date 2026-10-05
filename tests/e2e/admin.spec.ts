import { expect, type Page, test } from "@playwright/test";
import { completeCode, signIn, watchPage } from "./support";

/**
 * Admin workspace through the real UI: every screen renders, and the core flows work. One admin
 * sign-in is shared by the serial tests below (sign-in codes are throttled per account).
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let problems: string[];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  problems = watchPage(page);
  await signIn(page, "admin", "/admin");
  await completeCode(page, "admin");
  await expect(page).toHaveURL(/\/admin$/);
});

test.afterAll(async () => {
  await page.close();
});

/** A form control by its label, ignoring the " (optional)" suffix on optional fields. */
const field = (label: string) => page.getByLabel(new RegExp(`^${label}( \\(optional\\))?$`));

const SCREENS = [
  ["/admin", /^Welcome/],
  ["/admin/enquiries", /^Enquiries$/],
  ["/admin/clients", /^Clients$/],
  ["/admin/engagements", /^Client projects$/],
  ["/admin/content", /^Content$/],
  ["/admin/projects", /^Case studies$/],
  ["/admin/services", /^Services$/],
  ["/admin/partners", /^Partners$/],
  ["/admin/careers", /^Careers$/],
  ["/admin/users", /^Users$/],
  ["/admin/roles", /^Roles and permissions$/],
  ["/admin/security", /^Security$/],
  ["/admin/audit", /^Audit log$/],
  ["/admin/settings", /^Settings$/],
  ["/admin/system", /./],
] as const;

test.describe("admin workspace", () => {
  test("every admin screen renders for an admin, without errors", async () => {
    for (const [path, heading] of SCREENS) {
      problems.length = 0;
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }), path).toHaveText(heading);
      // Let route discovery finish before moving on, so no request is cut off mid-flight.
      await page.waitForLoadState("networkidle");
      expect(problems, path).toEqual([]);
    }
    // A person's page opens from the users list.
    await page.goto("/admin/users");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByText("Two-step sign-in")).toBeVisible();
  });

  test("a case study is drafted, published, and only the published version is public", async ({
    browser,
  }) => {
    const slug = `e2e-study-${Date.now()}`;
    await page.goto("/admin/projects");
    await field("Title").fill("E2E Study");
    await field("Address").fill(slug);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Study");
    const status = page.locator(".v-ws__actions");
    await expect(status).toHaveText("Draft");

    await field("Summary").fill("A study written in the end-to-end test.");
    await field("Content").fill("## The brief\n\nMake it **clear**.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();
    expect((await page.request.get(`/work/${slug}`)).status()).toBe(404);

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText(/Published as version/)).toBeVisible();
    await expect(status).toHaveText("Live");

    await field("Title").fill("E2E Study (unpublished edit)");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(status).toHaveText("Live · unpublished changes");

    // A visitor (fresh, signed-out browser context) sees the published version.
    const visitor = await browser.newContext();
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/work/${slug}`);
    await expect(publicPage.getByRole("heading", { level: 1 })).toContainText("E2E Study");
    await expect(publicPage.getByText("unpublished edit")).toHaveCount(0);
    await expect(publicPage.getByRole("heading", { name: "The brief" })).toBeVisible();
    await visitor.close();
  });

  test("a client and project are created, and a file is uploaded and downloadable", async () => {
    await page.goto("/admin/clients");
    await field("Organisation name").fill(`E2E Client ${Date.now()}`);
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created.")).toBeVisible();

    await page.getByText(/^New project for/).click();
    await field("Project name").fill("E2E Website");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Website");

    await field("File").setInputFiles({
      name: "brief.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
    });
    await field("Label").fill("Project brief");
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("File uploaded.")).toBeVisible();
    const link = page.getByRole("link", { name: "Project brief" });
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/api\/v1\/files\/efl_/);
    const download = await page.request.get(href ?? "");
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toMatch(/^attachment;/);

    // A page that isn't a PDF but claims to be one is refused.
    await field("File").setInputFiles({
      name: "invoice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("alert").first()).toContainText(/don't match/);
  });

  test("staff can't open admin-only screens", async ({ page }) => {
    // A separate browser context: the staff account signs in on its own.
    await signIn(page, "staff", "/admin");
    await completeCode(page, "staff");
    await expect(page).toHaveURL(/\/admin$/);
    for (const path of ["/admin/users", "/admin/settings", "/admin/security", "/admin/audit"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(403);
    }
  });
});
