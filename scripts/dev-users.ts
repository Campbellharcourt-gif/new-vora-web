/**
 * LOCAL DEVELOPMENT ONLY: creates one active user per role in the local D1 database so every
 * area can be exercised. Refuses to run against anything but --local. Passwords are printed once.
 *
 *   npm run dev:users
 *   tsx scripts/dev-users.ts --persist-to .wrangler/e2e-state --out .wrangler/e2e-state/users.json
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argon2id } from "@noble/hashes/argon2.js";
import { lit } from "../app/.server/db/seed/sql";
import { newId } from "../app/.server/lib/ids";
import { DEFAULT_ROLES } from "../shared/permissions";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").replace(/=+$/, "");

function hash(password: string): string {
  const salt = randomBytes(16);
  const out = argon2id(new TextEncoder().encode(password.normalize("NFKC")), salt, {
    m: 19456,
    t: 2,
    p: 1,
    dkLen: 32,
  });
  return `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(out)}`;
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const persistTo = option("--persist-to");
const out = option("--out");
// Optional user set (e.g. `--set sec` → staff.sec@vora.test) so separate test suites never share
// accounts, sign-in codes or cooldowns. Default: <role>@vora.test.
const set = option("--set");
if (set !== undefined && !/^[a-z0-9]{1,12}$/.test(set)) {
  console.error("--set must be 1–12 lowercase letters or digits.");
  process.exit(1);
}

const now = Date.now();
const statements: string[] = [];
const printed: string[] = [];
const credentials: Record<string, { email: string; password: string }> = {};
for (const role of DEFAULT_ROLES) {
  const email = set ? `${role.key}.${set}@vora.test` : `${role.key}@vora.test`;
  const password = `dev-${role.key}-${randomBytes(6).toString("hex")}`;
  const id = newId("user", now);
  statements.push(
    `INSERT INTO users (id, email, email_verified_at, name, password_hash, status, password_changed_at, created_at, updated_at) VALUES (${lit(id)}, ${lit(email)}, ${now}, ${lit(`Dev ${role.name}`)}, ${lit(hash(password))}, 'active', ${now}, ${now}, ${now}) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, status = 'active', locked_until = NULL;`,
    `INSERT INTO user_roles (user_id, role_id, granted_at) SELECT u.id, r.id, ${now} FROM users u, roles r WHERE u.email = ${lit(email)} AND r.key = ${lit(role.key)} ON CONFLICT DO NOTHING;`,
  );
  printed.push(`${role.name.padEnd(8)} ${email.padEnd(22)} ${password}`);
  credentials[role.key] = { email, password };
}

if (out && !resolve(out).startsWith(resolve(".wrangler"))) {
  console.error(
    "--out must be inside .wrangler/ (git-ignored) so credentials are never committed.",
  );
  process.exit(1);
}

const dir = join(process.cwd(), ".wrangler", "tmp");
mkdirSync(dir, { recursive: true });
const file = join(dir, `dev-users-${now}.sql`);
writeFileSync(file, `${statements.join("\n")}\n`);
execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    ...(persistTo ? ["--persist-to", persistTo] : []),
    "--file",
    file,
    "--yes",
  ],
  { stdio: "inherit" },
);
if (out) {
  // E2E only: credentials for the throwaway local database, written inside .wrangler (git-ignored).
  writeFileSync(out, JSON.stringify(credentials, null, 2));
}
console.log("\nLocal development users (sign-in codes appear at /api/dev/mailbox):\n");
console.log(printed.join("\n"));
