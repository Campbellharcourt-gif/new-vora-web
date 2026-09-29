// E2E only: writes throwaway secrets for the local production servers into the BUILD OUTPUT
// (build/server/.dev.vars) — never into your own .dev.vars. E2E therefore never sees real keys
// (Resend, Turnstile, Gemini stay unset → capture mail, Turnstile skipped, AI off), and a fresh
// clone can run `npm run test:e2e` without any setup. scripts/e2e-servers.ts loads this file.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

if (!existsSync("build/server/index.js")) {
  console.error("build/server/index.js not found — run the build first.");
  process.exit(1);
}
const lines = [
  `AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
  "AUTH_SECRET_PREVIOUS=",
  "RESEND_API_KEY=",
  "RESEND_WEBHOOK_SECRET=",
  "TURNSTILE_SECRET_KEY=",
  "GEMINI_API_KEY=",
  `SETUP_TOKEN=${randomBytes(24).toString("base64url")}`,
];
writeFileSync("build/server/.dev.vars", `${lines.join("\n")}\n`, { mode: 0o600 });
console.log("E2E: throwaway secrets written to build/server/.dev.vars");
