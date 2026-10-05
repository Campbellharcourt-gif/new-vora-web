import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, type Page } from "@playwright/test";

export type RoleKey = "owner" | "admin" | "manager" | "staff" | "client" | "member";

/**
 * Credentials created by `npm run e2e:prepare` for the throwaway local database. `set` picks a
 * separate account set (e.g. "adm"), so suites don't share sign-in code cooldowns.
 */
export function credentials(role: RoleKey, set?: string): { email: string; password: string } {
  const file = join(
    process.cwd(),
    ".wrangler",
    "e2e-state",
    set ? `users-${set}.json` : "users.json",
  );
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    { email: string; password: string }
  >;
  const found = all[role];
  if (!found) throw new Error(`No E2E credentials for ${role}`);
  return found;
}

/** Latest sign-in code for an address from the local capture mailbox (dev/test only endpoint). */
export async function latestCode(request: APIRequestContext, email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
        const body = (await res.json()) as { messages: { subject: string; text: string }[] };
        const message = body.messages.find((m) => /sign-in code/.test(m.subject));
        code = message ? /\b(\d{6})\b/.exec(message.text)?.[1] : undefined;
        return code;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return code as string;
}

export async function signIn(
  page: Page,
  role: RoleKey,
  next?: string,
  set?: string,
): Promise<void> {
  const { email, password } = credentials(role, set);
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function completeCode(page: Page, role: RoleKey, set?: string): Promise<void> {
  await expect(page).toHaveURL(/\/login\/verify/);
  const code = await latestCode(page.request, credentials(role, set).email);
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
}

/** Collects console errors and failed same-origin requests during a test. */
export function watchPage(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}
