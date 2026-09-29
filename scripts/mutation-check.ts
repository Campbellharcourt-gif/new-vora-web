/**
 * Mutation check (Railway migration §13.1): each entry deliberately breaks one safeguard, runs the
 * tests that should notice, and restores the file. A mutation that the tests do NOT catch fails
 * the check. Local only; the working tree is restored after every mutation (even on error).
 *
 *   npx tsx scripts/mutation-check.ts            # all
 *   npx tsx scripts/mutation-check.ts 3 9        # by number
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

interface Mutation {
  name: string;
  file: string;
  find: string;
  replace: string;
  /** Further edits to the same file, applied together with the first. */
  also?: { find: string; replace: string }[];
  config: "unit" | "integration";
  tests: string[];
}

const MUTATIONS: Mutation[] = [
  // --- CP-3's seven, restated for the native path --------------------------------------------
  {
    name: "password reset burns its token before hashing",
    file: "app/.server/auth/password-reset.ts",
    find: "const passwordHash = await passwordHashing(ctx).hash(newPassword);",
    replace: "",
    config: "integration",
    tests: ["tests/integration/password-hashing-native.test.ts"],
  },
  {
    name: "invitation is claimed before hashing",
    file: "app/.server/auth/invitations.ts",
    find: "const passwordHash = await passwordHashing(ctx).hash(input.password);",
    replace: "",
    config: "integration",
    tests: ["tests/integration/password-hashing-native.test.ts"],
  },
  {
    name: "first-Owner setup hashes inside the 'already completed' catch",
    file: "app/.server/auth/bootstrap.ts",
    find: "const passwordHash = await passwordHashing(ctx).hash(input.password);",
    replace:
      'const passwordHash = await passwordHashing(ctx).hash(input.password).catch(() => { throw new AppError("conflict"); });',
    config: "integration",
    tests: ["tests/integration/password-hashing-native.test.ts"],
  },
  {
    name: "a weaker-than-policy hash is accepted",
    file: "app/.server/auth/password-hashing.ts",
    find: 'if (typeof encoded !== "string" || !isPolicyHash(encoded)) {',
    replace: 'if (typeof encoded !== "string") {',
    config: "unit",
    tests: ["tests/unit/password-hashing.test.ts"],
  },
  {
    name: "unknown-email timing burn uses a cheaper path than a real verify",
    file: "app/.server/auth/password-hashing.ts",
    find: "await verify(password, TIMING_DUMMY_HASH);",
    replace: "void password;",
    config: "unit",
    tests: ["tests/unit/password-hashing.test.ts"],
  },
  {
    name: "a hashing outage is treated as a wrong password (fail open)",
    file: "app/.server/auth/password-hashing.ts",
    find: 'throw unavailable(operation, "argon2_error", error);',
    replace: "return false as never;",
    config: "unit",
    tests: ["tests/unit/password-hashing.test.ts"],
  },
  {
    name: "the email batch goes back to the Workers-Free value",
    file: "app/.server/jobs/scheduled.ts",
    find: "export const EMAIL_RETRY_BATCH = 25;",
    replace: "export const EMAIL_RETRY_BATCH = 10;",
    config: "unit",
    tests: ["tests/tooling/railway-config.test.ts"],
  },
  // --- New for Railway -----------------------------------------------------------------------
  {
    name: "SQLite foreign keys switched off (the start-up guard must refuse)",
    file: "server/platform/sqlite.ts",
    find: 'await client.execute("PRAGMA foreign_keys = ON");',
    replace: 'await client.execute("PRAGMA foreign_keys = OFF");',
    config: "integration",
    tests: ["tests/integration/sqlite-platform.test.ts"],
  },
  {
    name: "SQLite foreign keys switched off AND the guard removed (the FK tests must catch it)",
    file: "server/platform/sqlite.ts",
    find: 'await client.execute("PRAGMA foreign_keys = ON");',
    replace: 'await client.execute("PRAGMA foreign_keys = OFF");',
    also: [
      { find: "  if (state.foreignKeys !== 1) {", replace: "  if (state.foreignKeys === 99) {" },
    ],
    config: "integration",
    tests: ["tests/integration/sqlite-platform.test.ts", "tests/integration/database.test.ts"],
  },
  {
    name: "origin authentication not enforced in production",
    file: "server/runtime.ts",
    find: "enforceOriginAuth: config.productionLike,",
    replace: "enforceOriginAuth: false,",
    config: "integration",
    tests: ["tests/integration/server-lifecycle.test.ts"],
  },
  {
    name: "any origin-auth value accepted",
    file: "server/platform/trust.ts",
    find: "if (!presented || !safeEqual(presented, secret)) {",
    replace: "if (!presented) {",
    config: "unit",
    tests: ["tests/unit/platform-trust.test.ts"],
  },
  {
    name: "client-supplied CF-Connecting-IP trusted without origin auth",
    file: "server/platform/trust.ts",
    find: "for (const name of TRUSTED_CLIENT_HEADERS) headers.delete(name);",
    replace: "",
    config: "unit",
    tests: ["tests/unit/platform-trust.test.ts"],
  },
  {
    name: "public URL taken from the Host header",
    file: "server/platform/trust.ts",
    find: "const publicUrl = new URL(relative, config.appOrigin);",
    replace:
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source code injected by this mutation
      'const publicUrl = new URL(relative, `https://${incoming.headers.get("host") ?? "localhost"}`);',
    config: "unit",
    tests: ["tests/unit/platform-trust.test.ts"],
  },
  {
    name: "Access JWT audience not checked",
    file: "server/platform/trust.ts",
    find: 'if (!audiences.includes(this.options.audience)) return "wrong_audience";',
    replace: "",
    config: "unit",
    tests: ["tests/unit/platform-trust.test.ts"],
  },
  {
    name: "Argon2id self-test ignores the known answer",
    file: "app/.server/auth/password.ts",
    find: 'if (derived !== hash) throw new Error("Argon2id self-test failed: wrong known-answer output");',
    replace: "void derived;",
    config: "unit",
    tests: ["tests/unit/argon2-native.test.ts"],
  },
  {
    name: "rate limiter allows one request too many",
    file: "server/platform/rate-limiter.ts",
    find: "if (recent.length >= this.limitPerWindow) {",
    replace: "if (recent.length > this.limitPerWindow) {",
    config: "unit",
    tests: ["tests/unit/platform-runtime.test.ts"],
  },
  {
    name: "scheduler overlap guard removed",
    file: "server/platform/scheduler.ts",
    find: "const inFlight = this.running.get(pattern);",
    replace: "const inFlight = undefined as Promise<void> | undefined;",
    config: "unit",
    tests: ["tests/unit/platform-runtime.test.ts"],
  },
  {
    name: "a migration file is applied statement by statement (not atomic)",
    file: "server/platform/sqlite.ts",
    find: "      await db.client.batch(\n        [\n          ...migration.queries,",
    replace:
      "      for (const q of migration.queries) await db.client.execute(q);\n      await db.client.batch(\n        [",
    config: "integration",
    tests: ["tests/integration/sqlite-platform.test.ts"],
  },
  {
    name: "source maps served publicly",
    file: "server/platform/static.ts",
    find: 'if (/(^|\\/)\\./.test(urlPath) || urlPath.endsWith(".map")) continue;',
    replace: "if (/(^|\\/)\\./.test(urlPath)) continue;",
    config: "unit",
    tests: ["tests/unit/platform-runtime.test.ts"],
  },
  {
    name: "shutdown does not wait for background work",
    file: "server/runtime.ts",
    find: "const tasksDone = await background.drain(remaining());",
    replace: "const tasksDone = true;",
    config: "integration",
    tests: ["tests/integration/server-lifecycle.test.ts"],
  },
];

const selected = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => Number.isInteger(n) && n > 0);
const list = MUTATIONS.map((m, i) => ({ ...m, n: i + 1 })).filter(
  (m) => selected.length === 0 || selected.includes(m.n),
);

let caught = 0;
for (const m of list) {
  const original = readFileSync(m.file, "utf8");
  const count = original.split(m.find).length - 1;
  if (count !== 1) {
    console.log(`  ERROR  ${m.n}. ${m.name} — pattern found ${count} times in ${m.file}`);
    process.exitCode = 1;
    continue;
  }
  let mutated = original.replace(m.find, m.replace);
  for (const edit of m.also ?? []) {
    if (mutated.split(edit.find).length - 1 !== 1)
      throw new Error(`${m.n}: 'also' pattern not unique`);
    mutated = mutated.replace(edit.find, edit.replace);
  }
  writeFileSync(m.file, mutated);
  let run: ReturnType<typeof spawnSync>;
  try {
    run = spawnSync(
      "npx",
      ["vitest", "run", "--config", `vitest.${m.config}.config.ts`, ...m.tests],
      { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } },
    );
  } finally {
    writeFileSync(m.file, original);
  }
  const failed = run.status !== 0;
  if (failed) caught += 1;
  else process.exitCode = 1;
  const out = String(run.stdout);
  const summary =
    /Tests\s+([^\n]+)/.exec(out)?.[1]?.trim() ??
    (/Error|failed/i.test(out + String(run.stderr)) ? "suite refused to start (setup failed)" : "");
  console.log(`  ${failed ? "CAUGHT" : "MISSED"}  ${m.n}. ${m.name} — ${summary}`);
}
console.log(`\nMutation check: ${caught}/${list.length} regressions caught; every file restored.`);
