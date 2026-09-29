import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  PERMISSIONS,
  permissionCategory,
  RBAC_VERSION,
} from "@shared/permissions";
import { newId } from "../../lib/ids";
import {
  SEED_JOB_ROLES,
  SEED_PAGES,
  SEED_PARTNERS,
  SEED_PROJECTS,
  SEED_SERVICES,
  SEED_SOCIAL_LINKS,
} from "./definitions";

/**
 * Builds idempotent SQL for base data. Used by `scripts/seed.ts` (via `wrangler d1 execute`) and
 * by integration tests. RBAC rows are upserted from code; content rows use ON CONFLICT DO NOTHING
 * so re-running a seed never overwrites edits made in the admin.
 */
export function lit(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number in seed");
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

const json = (value: unknown) => lit(JSON.stringify(value));

export function rbacStatements(now: number): string[] {
  const out: string[] = [];
  for (const key of ALL_PERMISSIONS) {
    out.push(
      `INSERT INTO permissions (key, category, description) VALUES (${lit(key)}, ${lit(permissionCategory(key))}, ${lit(PERMISSIONS[key])}) ON CONFLICT(key) DO UPDATE SET category = excluded.category, description = excluded.description;`,
    );
  }
  out.push(`DELETE FROM permissions WHERE key NOT IN (${ALL_PERMISSIONS.map(lit).join(", ")});`);
  for (const role of DEFAULT_ROLES) {
    out.push(
      `INSERT INTO roles (id, key, name, description, rank, is_system, is_privileged, created_at, updated_at) VALUES (${lit(newId("role", now))}, ${lit(role.key)}, ${lit(role.name)}, ${lit(role.description)}, ${role.rank}, 1, ${lit(role.privileged)}, ${now}, ${now}) ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description, rank = excluded.rank, is_system = 1, is_privileged = excluded.is_privileged, updated_at = excluded.updated_at;`,
    );
    out.push(
      `DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE key = ${lit(role.key)});`,
    );
    for (const permission of role.permissions) {
      out.push(
        `INSERT INTO role_permissions (role_id, permission_key) SELECT id, ${lit(permission)} FROM roles WHERE key = ${lit(role.key)} ON CONFLICT DO NOTHING;`,
      );
    }
  }
  out.push(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('system.rbac_version', ${lit(String(RBAC_VERSION))}, ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  );
  return out;
}

export function contentStatements(now: number): string[] {
  const out: string[] = [];
  for (const s of SEED_SOCIAL_LINKS) {
    out.push(
      `INSERT INTO social_links (id, platform, label, url, handle, placements, sort_order, is_visible, created_at, updated_at) SELECT ${lit(newId("social", now))}, ${lit(s.platform)}, ${lit(s.label)}, ${lit(s.url)}, ${lit(s.handle)}, ${json(s.placements)}, ${s.sortOrder}, 1, ${now}, ${now} WHERE NOT EXISTS (SELECT 1 FROM social_links WHERE url = ${lit(s.url)});`,
    );
  }
  for (const p of SEED_PARTNERS) {
    out.push(
      `INSERT INTO partners (id, slug, status, name, relationship, description, statement, url, sort_order, has_unpublished_changes, created_at, updated_at) VALUES (${lit(newId("partner", now))}, ${lit(p.slug)}, 'draft', ${lit(p.name)}, ${lit(p.relationship)}, ${lit(p.description)}, ${lit(p.statement)}, NULL, 0, 1, ${now}, ${now}) ON CONFLICT(slug) DO NOTHING;`,
    );
  }
  for (const s of SEED_SERVICES) {
    const partner = s.partnerSlug
      ? `(SELECT id FROM partners WHERE slug = ${lit(s.partnerSlug)})`
      : "NULL";
    out.push(
      `INSERT INTO services (id, slug, status, name, summary, body, delivery_model, partner_id, sort_order, has_unpublished_changes, created_at, updated_at) VALUES (${lit(newId("service", now))}, ${lit(s.slug)}, 'draft', ${lit(s.name)}, ${lit(s.summary)}, '[]', ${lit(s.deliveryModel)}, ${partner}, ${s.sortOrder}, 1, ${now}, ${now}) ON CONFLICT(slug) DO NOTHING;`,
    );
  }
  for (const page of SEED_PAGES) {
    out.push(
      `INSERT INTO pages (id, key, status, title, intro, body, has_unpublished_changes, created_at, updated_at) VALUES (${lit(newId("page", now))}, ${lit(page.key)}, 'draft', ${lit(page.title)}, ${lit(page.intro)}, ${json(page.body)}, 1, ${now}, ${now}) ON CONFLICT(key) DO NOTHING;`,
    );
  }
  for (const project of SEED_PROJECTS) {
    out.push(
      `INSERT INTO projects (id, slug, status, title, category, summary, body, client_name, credits, external_url, sort_order, has_unpublished_changes, created_at, updated_at) VALUES (${lit(newId("project", now))}, ${lit(project.slug)}, 'draft', ${lit(project.title)}, ${lit(project.category)}, ${lit(project.summary)}, '[]', ${lit(project.clientName)}, '[]', ${lit(project.externalUrl)}, ${project.sortOrder}, 1, ${now}, ${now}) ON CONFLICT(slug) DO NOTHING;`,
    );
    for (const serviceSlug of project.serviceSlugs) {
      out.push(
        `INSERT INTO project_services (project_id, service_id) SELECT p.id, s.id FROM projects p, services s WHERE p.slug = ${lit(project.slug)} AND s.slug = ${lit(serviceSlug)} ON CONFLICT DO NOTHING;`,
      );
    }
  }
  for (const role of SEED_JOB_ROLES) {
    out.push(
      `INSERT INTO job_roles (id, slug, status, title, body, application_mode, sort_order, has_unpublished_changes, created_at, updated_at) VALUES (${lit(newId("jobRole", now))}, ${lit(role.slug)}, 'draft', ${lit(role.title)}, '[]', 'email', ${role.sortOrder}, 1, ${now}, ${now}) ON CONFLICT(slug) DO NOTHING;`,
    );
  }
  return out;
}

export function baseSeedStatements(now = Date.now()): string[] {
  return [...rbacStatements(now), ...contentStatements(now)];
}
