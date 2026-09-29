import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Local development defaults — what the top level of `wrangler.jsonc` provided on Workers. Plain,
 * non-secret values only (tests/tooling/railway-config.test.ts enforces that). Secrets come from
 * `.dev.vars` locally (git-ignored; `.dev.vars.example` lists the names) and from sealed Railway
 * variables in staging and production, where none of these defaults apply: the production entry
 * (server/main.ts) never reads this file and refuses to start without an explicit APP_ENV.
 */
export const LOCAL_DEFAULTS: Readonly<Record<string, string>> = {
  APP_ENV: "development",
  APP_ORIGIN: "http://localhost:5173",
  APP_NAME: "VORA",
  EMAIL_TRANSPORT: "capture",
  EMAIL_FROM: "VORA <hello@vorawebsites.store>",
  EMAIL_REPLY_TO: "hello@vorawebsites.store",
  TEAM_NOTIFY_EMAIL: "projects@vorawebsites.store",
  CAREERS_NOTIFY_EMAIL: "careers@vorawebsites.store",
  // Cloudflare's public "always passes" TEST site key; refused in staging/production (H1).
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  AI_GATEWAY_BASE_URL: "",
  MAINTENANCE_MODE: "off",
  LOG_LEVEL: "debug",
  HOST: "localhost",
  PORT: "5173",
};

/** Reads a dotenv-style file (`.dev.vars`); a missing file is an empty set. */
export function readVarsFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}
