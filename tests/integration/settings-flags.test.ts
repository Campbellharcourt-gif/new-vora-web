import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "~/.server/lib/errors";
import { isFlagEnabled, setFeatureFlag } from "~/.server/services/flags";
import { getMaintenanceState } from "~/.server/services/maintenance";
import { getSetting, SETTINGS, setSetting } from "~/.server/services/settings";
import {
  actorFor,
  createUser,
  db,
  makeCtx,
  putSetting,
  resetCaches,
  schema,
} from "../support/helpers";

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("feature flags", () => {
  it("falls back to code defaults, then honours stored overrides and rules", async () => {
    resetCaches();
    const ctx = makeCtx();
    expect(await isFlagEnabled(ctx, "ai.public_assistant")).toBe(false);
    expect(await isFlagEnabled(ctx, "auth.breach_check")).toBe(true);

    const owner = await actorFor((await createUser({ roles: ["owner"] })).id);
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);

    await setFeatureFlag(ctx, owner, "ai.public_assistant", { enabled: true });
    expect(await isFlagEnabled(ctx, "ai.public_assistant")).toBe(true);

    await setFeatureFlag(ctx, owner, "ai.public_assistant", {
      enabled: true,
      rules: { environments: ["production"] },
    });
    expect(await isFlagEnabled(ctx, "ai.public_assistant")).toBe(false); // tests run as "test"

    await setFeatureFlag(ctx, owner, "ai.admin_tools", {
      enabled: true,
      rules: { roles: ["admin"] },
    });
    expect(await isFlagEnabled(ctx, "ai.admin_tools", admin)).toBe(true);
    expect(await isFlagEnabled(ctx, "ai.admin_tools", staff)).toBe(false);
    expect(await isFlagEnabled(ctx, "ai.admin_tools", null)).toBe(false);

    await setFeatureFlag(ctx, owner, "auth.breach_check", { enabled: false });
    expect(await isFlagEnabled(ctx, "auth.breach_check")).toBe(false);

    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "flag.update"))
      .all();
    expect(audit).toHaveLength(4);
    expect(audit[1]?.changes).toMatchObject({
      from: { enabled: true, rules: null },
      to: { enabled: true, rules: { environments: ["production"] } },
    });
  });

  it("requires flags.manage and rejects unknown flags or malformed rules", async () => {
    const ctx = makeCtx();
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id);
    expect(
      (await appError(setFeatureFlag(ctx, manager, "ai.public_assistant", { enabled: true }))).code,
    ).toBe("forbidden");
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    expect((await appError(setFeatureFlag(ctx, admin, "made.up", { enabled: true }))).code).toBe(
      "validation_failed",
    );
    for (const rules of [
      { roles: ["god"] },
      { environments: ["moon"] },
      { roles: [] },
      { extra: true },
    ]) {
      expect(
        (
          await appError(
            setFeatureFlag(ctx, admin, "ai.public_assistant", { enabled: true, rules }),
          )
        ).code,
        JSON.stringify(rules),
      ).toBe("validation_failed");
    }
  });
});

describe("site settings", () => {
  it("authorises by setting, validates, audits and records maintenance changes", async () => {
    const ctx = makeCtx();
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    expect(
      (await appError(setSetting(ctx, staff, "maintenance", { enabled: true, message: null })))
        .code,
    ).toBe("forbidden");
    expect((await appError(setSetting(ctx, null, "site.identity", {}))).code).toBe(
      "unauthenticated",
    );

    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const invalid = await appError(
      setSetting(ctx, admin, "maintenance", { enabled: "yes", message: null }),
    );
    expect(invalid.code).toBe("validation_failed");

    await setSetting(ctx, admin, "maintenance", { enabled: true, message: "Upgrading" });
    expect(await getMaintenanceState(ctx)).toEqual({
      enabled: true,
      message: "Upgrading",
      source: "setting",
    });
    await setSetting(ctx, admin, "maintenance", { enabled: false, message: null });
    expect((await getMaintenanceState(ctx)).enabled).toBe(false);

    const events = await db
      .select()
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.type, "maintenance.changed"))
      .all();
    expect(events.map((e) => (e.details as { enabled: boolean }).enabled)).toEqual([true, false]);
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, "maintenance"))
      .all();
    expect(audit).toHaveLength(2);

    // AI configuration needs ai.manage (Admins have it; Managers do not).
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id);
    const aiConfig = { ...SETTINGS["ai.config"].default, publicEnabled: true };
    expect((await appError(setSetting(ctx, manager, "ai.config", aiConfig))).code).toBe(
      "forbidden",
    );
    await setSetting(ctx, admin, "ai.config", aiConfig);
    expect((await getSetting(ctx, "ai.config")).publicEnabled).toBe(true);
  });

  it("serves the default when a stored value is corrupt instead of breaking pages", async () => {
    await putSetting("enquiry.options", { budgets: "not-a-list" });
    const options = await getSetting(makeCtx(), "enquiry.options");
    expect(options).toEqual(SETTINGS["enquiry.options"].default);
  });
});
