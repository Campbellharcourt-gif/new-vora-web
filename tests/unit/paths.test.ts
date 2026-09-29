import { describe, expect, it } from "vitest";
import { isPrivatePath } from "~/.server/kernel/headers";
import { pagePath } from "~/.server/lib/paths";
import { isMaintenanceExempt } from "~/.server/services/maintenance";

describe("single-fetch data URLs follow their page's policy", () => {
  it("maps data URLs back to page paths", () => {
    expect(pagePath("/account.data")).toBe("/account");
    expect(pagePath("/admin/users.data")).toBe("/admin/users");
    expect(pagePath("/_.data")).toBe("/");
    expect(pagePath("/work/_.data")).toBe("/work/");
    expect(pagePath("/work/sail-gaming")).toBe("/work/sail-gaming");
    expect(pagePath("/")).toBe("/");
  });

  it("keeps private-area data out of caches like the pages themselves", () => {
    for (const path of [
      "/account.data",
      "/account/security.data",
      "/admin.data",
      "/member.data",
      "/client.data",
      "/login.data",
    ]) {
      expect(isPrivatePath(path), path).toBe(true);
    }
    for (const path of ["/_.data", "/work.data", "/contact.data", "/services.data"]) {
      expect(isPrivatePath(path), path).toBe(false);
    }
  });

  it("lets staff sign in during maintenance when the form posts to /login.data", () => {
    for (const path of [
      "/login.data",
      "/login/verify.data",
      "/login/recovery.data",
      "/logout.data",
    ]) {
      expect(isMaintenanceExempt(path), path).toBe(true);
    }
    for (const path of ["/_.data", "/contact.data", "/admin.data", "/loginx.data"]) {
      expect(isMaintenanceExempt(path), path).toBe(false);
    }
  });
});
