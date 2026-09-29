import { ALL_PERMISSIONS, DEFAULT_ROLES } from "@shared/permissions";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { syncRbac } from "~/.server/auth/rbac";
import { baseSeedStatements } from "~/.server/db/seed/sql";
import { newId } from "~/.server/lib/ids";
import { listPublishedProjects } from "~/.server/services/published-content";
import { createUser, db, env, makeCtx, schema } from "../support/helpers";

const DAY = 86_400_000;

async function expectSqlError(sql: string, pattern: RegExp) {
  await expect(env.DB.prepare(sql).run()).rejects.toThrow(pattern);
}

describe("migrations", () => {
  it("creates every table and the integrity triggers", async () => {
    const tables = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'",
    ).all<{ name: string }>();
    const names = new Set(tables.results.map((t) => t.name));
    for (const table of [
      "users",
      "sessions",
      "roles",
      "permissions",
      "role_permissions",
      "user_roles",
      "mfa_challenges",
      "recovery_codes",
      "login_attempts",
      "auth_tokens",
      "invitations",
      "enquiries",
      "enquiry_events",
      "email_outbox",
      "audit_logs",
      "security_events",
      "content_versions",
      "projects",
      "services",
      "pages",
      "partners",
      "job_roles",
      "media_assets",
      "client_orgs",
      "engagements",
      "engagement_files",
      "ai_usage",
      "feature_flags",
      "site_settings",
      "job_runs",
    ]) {
      expect(names.has(table), table).toBe(true);
    }
    const triggers = await env.DB.prepare(
      "select name from sqlite_master where type = 'trigger' order by name",
    ).all<{ name: string }>();
    expect(triggers.results.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "audit_logs_no_update",
        "audit_logs_retention_delete",
        "security_events_no_update",
        "security_events_retention_delete",
        "content_versions_no_update",
        "content_versions_keep_published",
        "user_roles_keep_last_owner",
      ]),
    );
  });

  it("enforces foreign keys", async () => {
    await expectSqlError(
      `insert into user_roles (user_id, role_id, granted_at) values ('usr_missing', 'rol_missing', 1)`,
      /FOREIGN KEY/i,
    );
  });
});

describe("base seed", () => {
  it("creates the six system roles with the code-defined permissions", async () => {
    const roles = await db.select().from(schema.roles).all();
    expect(roles.map((r) => r.key).sort()).toEqual(DEFAULT_ROLES.map((r) => r.key).sort());
    for (const def of DEFAULT_ROLES) {
      const role = roles.find((r) => r.key === def.key);
      expect(role?.rank).toBe(def.rank);
      expect(role?.isPrivileged).toBe(def.privileged);
      const perms = await db
        .select({ key: schema.rolePermissions.permissionKey })
        .from(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, role?.id ?? ""))
        .all();
      expect(perms.map((p) => p.key).sort(), def.key).toEqual([...def.permissions].sort());
    }
    const permissions = await db.select().from(schema.permissions).all();
    expect(permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  it("seeds real content only, and only as drafts", async () => {
    const projects = await db.select().from(schema.projects).all();
    expect(projects.map((p) => p.slug).sort()).toEqual(["eon-clothing", "sail-gaming"]);
    for (const table of [schema.projects, schema.services, schema.pages, schema.partners]) {
      const rows = await db.select({ status: table.status }).from(table).all();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status === "draft")).toBe(true);
    }
    const jobs = await db.select({ status: schema.jobRoles.status }).from(schema.jobRoles).all();
    expect(jobs.every((j) => j.status === "draft")).toBe(true);
    expect(await listPublishedProjects(makeCtx())).toEqual([]);
    const pricing = await env.DB.prepare(
      "select count(*) as n from site_settings where key like '%pric%' or value like '%$%'",
    ).first<{ n: number }>();
    expect(pricing?.n).toBe(0);
  });

  it("is idempotent and never overwrites admin edits", async () => {
    await db
      .update(schema.projects)
      .set({ summary: "Edited in admin" })
      .where(eq(schema.projects.slug, "sail-gaming"));
    const statements = baseSeedStatements(Date.now());
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50).map((s) => env.DB.prepare(s)));
    }
    const projects = await db.select().from(schema.projects).all();
    expect(projects).toHaveLength(2);
    expect(projects.find((p) => p.slug === "sail-gaming")?.summary).toBe("Edited in admin");
    expect(await db.select().from(schema.roles).all()).toHaveLength(6);
    expect(await db.select().from(schema.socialLinks).all()).toHaveLength(2);
  });

  it("re-syncs tampered system role composition from code, leaving custom roles alone", async () => {
    const staff = await db.select().from(schema.roles).where(eq(schema.roles.key, "staff")).get();
    await env.DB.prepare(
      "delete from role_permissions where role_id = ? and permission_key = 'enquiries.view'",
    )
      .bind(staff?.id)
      .run();
    await env.DB.prepare(
      "insert into role_permissions (role_id, permission_key) values (?, 'users.manage')",
    )
      .bind(staff?.id)
      .run();
    const now = Date.now();
    const customId = newId("role", now);
    await db.insert(schema.roles).values({
      id: customId,
      key: "reviewer",
      name: "Reviewer",
      rank: 30,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: customId, permissionKey: "projects.view" });

    expect(await syncRbac(db, now)).toBe(false); // version unchanged → no work
    expect(await syncRbac(db, now, true)).toBe(true);

    const perms = await db
      .select({ key: schema.rolePermissions.permissionKey })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, staff?.id ?? ""))
      .all();
    const keys = perms.map((p) => p.key);
    expect(keys).toContain("enquiries.view");
    expect(keys).not.toContain("users.manage");
    const custom = await db
      .select({ key: schema.rolePermissions.permissionKey })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, customId))
      .all();
    expect(custom.map((c) => c.key)).toEqual(["projects.view"]);
  });
});

describe("CHECK constraints", () => {
  const now = Date.now();
  it("rejects invalid user rows", async () => {
    await expectSqlError(
      `insert into users (id, email, name, status, created_at, updated_at) values ('usr_a', 'Upper@Case.com', 'x', 'invited', ${now}, ${now})`,
      /CHECK/i,
    );
    await expectSqlError(
      `insert into users (id, email, name, status, created_at, updated_at) values ('usr_b', 'b@x.co', 'x', 'god', ${now}, ${now})`,
      /CHECK/i,
    );
    await expectSqlError(
      `insert into users (id, email, name, status, created_at, updated_at) values ('usr_c', 'c@x.co', 'x', 'active', ${now}, ${now})`,
      /CHECK/i,
    );
  });

  it("rejects unsafe slugs, URLs and unpublished 'published' content", async () => {
    await expectSqlError(
      `insert into projects (id, slug, status, title, body, credits, created_at, updated_at) values ('prj_a', '../admin', 'draft', 't', '[]', '[]', ${now}, ${now})`,
      /CHECK/i,
    );
    await expectSqlError(
      `insert into projects (id, slug, status, title, body, credits, external_url, created_at, updated_at) values ('prj_b', 'ok-slug', 'draft', 't', '[]', '[]', 'javascript:alert(1)', ${now}, ${now})`,
      /CHECK/i,
    );
    await expectSqlError(
      `insert into projects (id, slug, status, title, body, credits, created_at, updated_at) values ('prj_c', 'ok-slug-2', 'published', 't', '[]', '[]', ${now}, ${now})`,
      /CHECK/i,
    );
    await expectSqlError(
      `insert into projects (id, slug, status, title, body, credits, created_at, updated_at) values ('prj_d', 'ok-slug-3', 'draft', 't', 'not json', '[]', ${now}, ${now})`,
      /CHECK/i,
    );
    await expectSqlError(
      `insert into social_links (id, platform, label, url, placements, created_at, updated_at) values ('soc_a', 'x', 'X', 'http://x.com', '[]', ${now}, ${now})`,
      /CHECK/i,
    );
  });
});

describe("append-only and retention triggers", () => {
  it("never updates audit or security rows and keeps them for their retention period", async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "insert into audit_logs (id, action, summary, created_at) values ('aud_new', 'x', 'recent', ?)",
      ).bind(now),
      env.DB.prepare(
        "insert into audit_logs (id, action, summary, created_at) values ('aud_old', 'x', 'old', ?)",
      ).bind(now - 3 * 365 * DAY),
      env.DB.prepare(
        "insert into security_events (id, type, severity, created_at) values ('sev_new', 'x', 'low', ?)",
      ).bind(now),
      env.DB.prepare(
        "insert into security_events (id, type, severity, created_at) values ('sev_old', 'x', 'low', ?)",
      ).bind(now - 400 * DAY),
    ]);
    await expectSqlError(
      "update audit_logs set summary = 'tampered' where id = 'aud_new'",
      /append-only/,
    );
    await expectSqlError("delete from audit_logs where id = 'aud_new'", /retained/);
    await env.DB.prepare("delete from audit_logs where id = 'aud_old'").run();
    await expectSqlError(
      "update security_events set severity = 'info' where id = 'sev_new'",
      /append-only/,
    );
    await expectSqlError("delete from security_events where id = 'sev_new'", /retained/);
    await env.DB.prepare("delete from security_events where id = 'sev_old'").run();
    const left = await env.DB.prepare(
      "select (select count(*) from audit_logs where id like 'aud_%') + (select count(*) from security_events where id like 'sev_%') as n",
    ).first<{ n: number }>();
    expect(left?.n).toBe(2);
  });

  it("keeps content versions immutable and published versions forever", async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "insert into content_versions (id, entity_type, entity_id, version, kind, snapshot, created_at) values ('ver_pub', 'project', 'prj_x', 1, 'published', '{}', ?)",
      ).bind(now),
      env.DB.prepare(
        "insert into content_versions (id, entity_type, entity_id, version, kind, snapshot, created_at) values ('ver_draft', 'project', 'prj_x', 2, 'draft', '{}', ?)",
      ).bind(now),
    ]);
    await expectSqlError(
      "update content_versions set snapshot = '{\"x\":1}' where id = 'ver_draft'",
      /immutable/,
    );
    await expectSqlError("delete from content_versions where id = 'ver_pub'", /kept/);
    await env.DB.prepare("delete from content_versions where id = 'ver_draft'").run();
  });
});

describe("last active Owner protection (database backstop)", () => {
  it("refuses to remove the only active Owner's role or delete their account", async () => {
    const owner = await createUser({ roles: ["owner"] });
    const ownerRole = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.key, "owner"))
      .get();
    await expectSqlError(
      `delete from user_roles where user_id = '${owner.id}' and role_id = '${ownerRole?.id}'`,
      /last active owner/,
    );
    await expectSqlError(`delete from users where id = '${owner.id}'`, /last active owner/);
    await expectSqlError(
      `update users set status = 'suspended' where id = '${owner.id}'`,
      /last active owner/,
    );

    const second = await createUser({ roles: ["owner"] });
    await env.DB.prepare(
      `delete from user_roles where user_id = '${second.id}' and role_id = '${ownerRole?.id}'`,
    ).run();
    // Back to one Owner: still protected.
    await expectSqlError(`delete from users where id = '${owner.id}'`, /last active owner/);
  });
});
