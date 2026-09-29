import { randomBytes } from "node:crypto";
import { hashPassword } from "../../app/.server/auth/password";
import { lit } from "../../app/.server/db/seed/sql";
import { newId } from "../../app/.server/lib/ids";
import type { SqlDatabase } from "../../app/.server/platform/types";
import { DEFAULT_ROLES } from "../../shared/permissions";

export type DevCredentials = Record<string, { email: string; password: string }>;

/**
 * LOCAL DEVELOPMENT / E2E ONLY: one active user per role, with a random password, hashed with the
 * application's own Argon2id (native, policy parameters). An optional `set` (e.g. "sec" →
 * staff.sec@vora.test) keeps separate test suites from sharing accounts, codes or cooldowns.
 */
export async function createDevUsers(
  db: SqlDatabase,
  set?: string,
): Promise<{ credentials: DevCredentials; printed: string[] }> {
  if (set !== undefined && !/^[a-z0-9]{1,12}$/.test(set)) {
    throw new Error("The user set must be 1–12 lowercase letters or digits.");
  }
  const now = Date.now();
  const statements: string[] = [];
  const printed: string[] = [];
  const credentials: DevCredentials = {};
  for (const role of DEFAULT_ROLES) {
    const email = set ? `${role.key}.${set}@vora.test` : `${role.key}@vora.test`;
    const password = `dev-${role.key}-${randomBytes(6).toString("hex")}`;
    const id = newId("user", now);
    statements.push(
      `INSERT INTO users (id, email, email_verified_at, name, password_hash, status, password_changed_at, created_at, updated_at) VALUES (${lit(id)}, ${lit(email)}, ${now}, ${lit(`Dev ${role.name}`)}, ${lit(await hashPassword(password))}, 'active', ${now}, ${now}, ${now}) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, status = 'active', locked_until = NULL;`,
      `INSERT INTO user_roles (user_id, role_id, granted_at) SELECT u.id, r.id, ${now} FROM users u, roles r WHERE u.email = ${lit(email)} AND r.key = ${lit(role.key)} ON CONFLICT DO NOTHING;`,
    );
    printed.push(`${role.name.padEnd(8)} ${email.padEnd(22)} ${password}`);
    credentials[role.key] = { email, password };
  }
  await db.batch(statements.map((sql) => db.prepare(sql)));
  return { credentials, printed };
}
