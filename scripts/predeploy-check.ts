/**
 * Pre-upload guard (CP-2.1 · H2). Runs inside `npm run deploy:<env>` after the build and the
 * security scan, and before `wrangler deploy`:
 *
 *   tsx scripts/predeploy-check.ts --env staging|production
 *
 * It validates the GENERATED deploy configuration — build/server/wrangler.json, exactly what
 * `wrangler deploy` uploads — against wrangler.jsonc and VORA's production-grade rules:
 *   - the build targets the intended environment and Worker (not the local development build)
 *   - no REPLACE_WITH_ placeholders; D1 database IDs are real UUIDs
 *   - no localhost, loopback or plain-http values in vars or routes
 *   - no KV namespaces (the DEV_MAILBOX dev mailbox exists only locally)
 *   - https origin, Resend transport, no debug logging, workers.dev and preview URLs off
 *   - the Turnstile site key is not one of Cloudflare's test keys
 *   - the required secrets are declared (secrets.required — see H3)
 *   - no route for www (www is a Redirect Rule at cutover, never a Worker route)
 *
 * Exits 1 listing every problem as "field: rule". It never prints values: the build
 * configuration holds no secret values, and field names are enough to act on.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isTurnstileTestKey } from "../shared/turnstile";
import { readJsonc } from "./lib/jsonc";

export type DeployEnv = "staging" | "production";

/** Secrets every deployed environment must hold (names only). Mirrors wrangler.jsonc. */
export const REQUIRED_SECRETS = ["AUTH_SECRET", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY"] as const;

/** Every secret the application reads — none of these may ever appear as a plain var. */
export const ALL_SECRET_NAMES = [
  ...REQUIRED_SECRETS,
  "AUTH_SECRET_PREVIOUS",
  "RESEND_WEBHOOK_SECRET",
  "GEMINI_API_KEY",
  "SETUP_TOKEN",
] as const;

export interface Problem {
  field: string;
  rule: string;
}

interface EnvSection {
  name?: string;
  routes?: unknown[];
}
interface UserConfig {
  env?: Partial<Record<DeployEnv, EnvSection>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEV_URL = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\.local\b|http:\/\//i;
const DEPLOYABLE_FIELDS = [
  "name",
  "routes",
  "vars",
  "d1_databases",
  "r2_buckets",
  "kv_namespaces",
  "ratelimits",
  "secrets",
] as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Every string inside a value, with its path (e.g. `vars.APP_ORIGIN`, `routes[0].pattern`). */
function strings(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) {
    value.forEach((v, i) => {
      strings(v, `${path}[${i}]`, out);
    });
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

const routeList = (routes: unknown): unknown[] => (Array.isArray(routes) ? routes : []);
const routePattern = (route: unknown): string =>
  typeof route === "string"
    ? route
    : route && typeof route === "object" && "pattern" in route
      ? String((route as { pattern: unknown }).pattern)
      : "";

/** Pure check of a built deploy configuration. Returns an empty list when it is safe to upload. */
export function checkDeployConfig(
  built: Record<string, unknown>,
  userConfig: UserConfig,
  env: DeployEnv,
): Problem[] {
  const problems: Problem[] = [];
  const add = (field: string, rule: string) => problems.push({ field, rule });
  const expected = userConfig.env?.[env] ?? {};

  if (built.targetEnvironment !== env) {
    add(
      "targetEnvironment",
      built.targetEnvironment
        ? `the build targets "${String(built.targetEnvironment)}", not "${env}" — rebuild with CLOUDFLARE_ENV=${env}`
        : `this is the LOCAL development build — rebuild with CLOUDFLARE_ENV=${env}`,
    );
  }
  if (!expected.name) add(`wrangler.jsonc env.${env}.name`, "missing");
  else if (built.name !== expected.name) {
    add("name", `expected the ${env} Worker "${expected.name}"`);
  }

  const builtRoutes = routeList(built.routes);
  if (JSON.stringify(builtRoutes) !== JSON.stringify(routeList(expected.routes))) {
    add("routes", `do not match wrangler.jsonc env.${env}.routes`);
  }
  builtRoutes.forEach((route, i) => {
    if (/^www\./i.test(routePattern(route).trim())) {
      add(`routes[${i}]`, "www must be a Redirect Rule to the apex, never a Worker route");
    }
  });
  if (built.workers_dev !== false) add("workers_dev", "must be false");
  if (built.preview_urls !== false) add("preview_urls", "must be false");

  for (const field of DEPLOYABLE_FIELDS) {
    for (const [path, text] of strings(built[field], field)) {
      if (text.includes("REPLACE_WITH")) add(path, "still a REPLACE_WITH_… placeholder");
    }
  }
  for (const field of ["vars", "routes"] as const) {
    for (const [path, text] of strings(built[field], field)) {
      if (DEV_URL.test(text)) add(path, "contains a localhost / loopback / plain-http value");
    }
  }

  const vars = (built.vars ?? {}) as Record<string, Json>;
  if (vars.APP_ENV !== env) add("vars.APP_ENV", `must be "${env}"`);
  if (typeof vars.APP_ORIGIN !== "string" || !vars.APP_ORIGIN.startsWith("https://")) {
    add("vars.APP_ORIGIN", "must be an https:// origin");
  }
  if (vars.EMAIL_TRANSPORT !== "resend") add("vars.EMAIL_TRANSPORT", 'must be "resend"');
  if (vars.LOG_LEVEL === "debug") add("vars.LOG_LEVEL", "debug logging is not allowed");
  const siteKey = typeof vars.TURNSTILE_SITE_KEY === "string" ? vars.TURNSTILE_SITE_KEY : "";
  if (!siteKey.trim()) add("vars.TURNSTILE_SITE_KEY", "missing");
  else if (isTurnstileTestKey(siteKey)) {
    add("vars.TURNSTILE_SITE_KEY", "is a Cloudflare Turnstile TEST key (always passes/fails)");
  }
  for (const name of ALL_SECRET_NAMES) {
    if (name in vars) add(`vars.${name}`, "secrets must never be plain vars");
  }

  const kv = Array.isArray(built.kv_namespaces) ? built.kv_namespaces : [];
  kv.forEach((ns, i) => {
    const binding = (ns as { binding?: string }).binding ?? "?";
    add(
      `kv_namespaces[${i}]`,
      binding === "DEV_MAILBOX"
        ? "the DEV_MAILBOX dev mailbox must never be deployed"
        : `unexpected KV binding "${binding}" (staging/production use no KV)`,
    );
  });

  const d1 = Array.isArray(built.d1_databases) ? built.d1_databases : [];
  if (d1.length === 0) add("d1_databases", "missing");
  d1.forEach((db, i) => {
    const id = (db as { database_id?: unknown }).database_id;
    if (typeof id !== "string" || !UUID.test(id)) {
      add(
        `d1_databases[${i}].database_id`,
        "must be the real database UUID from `wrangler d1 create`",
      );
    }
  });

  const required = (built.secrets as { required?: unknown } | undefined)?.required;
  const declared = Array.isArray(required) ? [...required].map(String).sort() : [];
  if (JSON.stringify(declared) !== JSON.stringify([...REQUIRED_SECRETS].sort())) {
    add("secrets.required", `must list exactly ${REQUIRED_SECRETS.join(", ")}`);
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const env = args[args.indexOf("--env") + 1];
  if (args.indexOf("--env") < 0 || (env !== "staging" && env !== "production")) {
    console.error("Usage: tsx scripts/predeploy-check.ts --env staging|production");
    process.exit(2);
  }
  const root = process.cwd();
  const builtPath = join(root, "build", "server", "wrangler.json");
  if (!existsSync(builtPath)) {
    console.error(
      `Pre-deploy check (${env}): build/server/wrangler.json not found — build with CLOUDFLARE_ENV=${env} first.`,
    );
    process.exit(1);
  }
  const built = JSON.parse(readFileSync(builtPath, "utf8")) as Record<string, unknown>;
  const userConfig = readJsonc<UserConfig>(join(root, "wrangler.jsonc"));
  const problems = checkDeployConfig(built, userConfig, env);
  if (problems.length > 0) {
    console.error(`\nPre-deploy check (${env}) FAILED — nothing was uploaded:`);
    for (const p of problems) console.error(`  ✗ ${p.field}: ${p.rule}`);
    process.exit(1);
  }
  console.log(`Pre-deploy check (${env}): OK — build/server/wrangler.json is safe to upload.`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
