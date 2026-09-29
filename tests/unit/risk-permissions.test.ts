import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  getRoleDefinition,
  isPermission,
} from "@shared/permissions";
import { describe, expect, it } from "vitest";
import { canGrantRole, canManageUser } from "~/.server/auth/rbac";
import { assessLoginRisk, type LoginHistory, RISK_THRESHOLDS } from "~/.server/auth/risk";

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const HOUR = 3_600_000;

function history(partial: Partial<LoginHistory> = {}): LoginHistory {
  return { successes: [], recentAccountFailures: 0, ipFailedAccounts: 0, ...partial };
}

const known = { deviceHash: "dev-a", country: "AU", asn: 1221, createdAt: NOW - 3 * 24 * HOUR };

describe("login risk scoring", () => {
  it("scores a first-ever sign-in with no signals as 0", () => {
    expect(
      assessLoginRisk(history(), { deviceHash: "x", country: "AU", asn: 1, now: NOW }),
    ).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it("scores a known device, country and network as 0", () => {
    const r = assessLoginRisk(history({ successes: [known] }), {
      deviceHash: "dev-a",
      country: "AU",
      asn: 1221,
      now: NOW,
    });
    expect(r.score).toBe(0);
  });

  it("new device alone stays below the code threshold", () => {
    const r = assessLoginRisk(history({ successes: [known] }), {
      deviceHash: "dev-b",
      country: "AU",
      asn: 1221,
      now: NOW,
    });
    expect(r.reasons).toEqual(["new_device"]);
    expect(r.score).toBeLessThan(RISK_THRESHOLDS.requireCode);
  });

  it("new device + new country requires an email code", () => {
    const r = assessLoginRisk(history({ successes: [known] }), {
      deviceHash: "dev-b",
      country: "US",
      asn: 7922,
      now: NOW,
    });
    expect(r.reasons).toEqual(["new_device", "new_country", "new_network"]);
    expect(r.score).toBeGreaterThanOrEqual(RISK_THRESHOLDS.requireCode);
  });

  it("impossible travel (country change within 2 hours) triggers an alert", () => {
    const recent = { ...known, createdAt: NOW - 30 * 60_000 };
    const r = assessLoginRisk(history({ successes: [recent] }), {
      deviceHash: "dev-b",
      country: "BR",
      asn: 28573,
      now: NOW,
    });
    expect(r.reasons).toContain("rapid_country_change");
    expect(r.score).toBeGreaterThanOrEqual(RISK_THRESHOLDS.alert);
  });

  it("caps failure contribution and total score", () => {
    const failures = assessLoginRisk(history({ recentAccountFailures: 50 }), {
      deviceHash: "x",
      country: null,
      asn: null,
      now: NOW,
    });
    expect(failures.score).toBe(30);
    const everything = assessLoginRisk(
      history({
        successes: [{ ...known, createdAt: NOW - 60_000 }],
        recentAccountFailures: 9,
        ipFailedAccounts: 20,
      }),
      { deviceHash: "dev-z", country: "RU", asn: 1, now: NOW },
    );
    expect(everything.score).toBe(100);
    expect(everything.reasons).toContain("ip_credential_stuffing_pattern");
  });
});

describe("permission catalogue and default roles", () => {
  it("uses only catalogued permissions, without duplicates", () => {
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) expect(isPermission(p), `${role.key}:${p}`).toBe(true);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
    expect(isPermission("toString")).toBe(false);
    expect(isPermission("__proto__")).toBe(false);
  });

  it("ranks roles strictly Owner > Admin > Manager > Staff > Client > Member", () => {
    const ranks = ["owner", "admin", "manager", "staff", "client", "member"].map(
      (k) => getRoleDefinition(k)?.rank ?? -1,
    );
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]).toBeGreaterThan(ranks[i] as number);
  });

  it("keeps role composition to Owners and portal access to portal roles", () => {
    const perms = (key: string) => new Set(getRoleDefinition(key)?.permissions);
    expect(perms("owner").has("roles.manage")).toBe(true);
    expect(perms("admin").has("roles.manage")).toBe(false);
    for (const key of ["owner", "admin", "manager", "staff"]) {
      expect(perms(key).has("client_portal.access")).toBe(false);
      expect(perms(key).has("admin.access")).toBe(true);
    }
    expect([...perms("client")]).toEqual(["client_portal.access"]);
    expect([...perms("member")]).toEqual(["member_portal.access"]);
    expect(perms("owner").size).toBe(ALL_PERMISSIONS.length - 2);
  });

  it("stops Staff from publishing, deleting or administering", () => {
    const staff = new Set(getRoleDefinition("staff")?.permissions);
    for (const p of ALL_PERMISSIONS) {
      if (/\.(publish|delete|manage)$/.test(p) && p !== "engagements.manage") {
        expect(staff.has(p), p).toBe(false);
      }
    }
    expect(staff.has("users.invite")).toBe(false);
    expect(staff.has("roles.assign")).toBe(false);
    expect(staff.has("security.view")).toBe(false);
  });

  it("marks every workspace role privileged (2FA) and portal roles not", () => {
    for (const role of DEFAULT_ROLES) {
      expect(role.privileged).toBe(role.permissions.includes("admin.access"));
    }
  });
});

describe("role-grant and user-management rules", () => {
  const actor = (roles: string[], rank: number, perms: string[]) => ({
    userId: "usr_A",
    roles,
    rank,
    permissions: new Set(perms) as never,
  });

  it("grants only roles ranked below the actor; only Owners grant Owner", () => {
    const admin = actor(["admin"], 80, ["roles.assign", "users.invite"]);
    expect(canGrantRole(admin, 60, "manager")).toBe(true);
    expect(canGrantRole(admin, 80, "admin")).toBe(false);
    expect(canGrantRole(admin, 100, "owner")).toBe(false);
    const owner = actor(["owner"], 100, ["roles.assign"]);
    expect(canGrantRole(owner, 100, "owner")).toBe(true);
    expect(canGrantRole(owner, 80, "admin")).toBe(true);
    const staff = actor(["staff"], 40, ["enquiries.view"]);
    expect(canGrantRole(staff, 10, "member")).toBe(false); // no grant permission at all
  });

  it("manages only lower-ranked users and never oneself", () => {
    const admin = { userId: "usr_A", rank: 80 };
    expect(canManageUser(admin, { userId: "usr_B", rank: 60 })).toBe(true);
    expect(canManageUser(admin, { userId: "usr_B", rank: 80 })).toBe(false);
    expect(canManageUser(admin, { userId: "usr_B", rank: 100 })).toBe(false);
    expect(canManageUser(admin, { userId: "usr_A", rank: 0 })).toBe(false);
  });
});
