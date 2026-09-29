/**
 * Local security scans (no network):
 *   1. Repository — every file git would commit (tracked + untracked, minus .gitignore) is checked
 *      for credential patterns and hard-coded secret assignments.
 *   2. Client bundle — `build/client` must contain no server code, secret names, secret values
 *      (read from the dotenv files passed with --secrets-from; missing files are skipped) or
 *      source maps. (Not `--env-file`: tsx hands that flag to Node, which aborts on a missing file.)
 *
 *   npm run security:scan                      # repository + build/client (+ values from .dev.vars)
 *   tsx scripts/security-scan.ts --bundle build/client --secrets-from .dev.vars
 *
 * Exits 1 on any finding. Findings print the file and rule, never the matched secret itself.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface Finding {
  file: string;
  rule: string;
}

export const SECRET_PATTERNS: readonly { rule: string; pattern: RegExp }[] = [
  { rule: "private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { rule: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: "Resend API key", pattern: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/ },
  { rule: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { rule: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: "Stripe live key", pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/ },
  { rule: "Turnstile secret", pattern: /\b0x4AAAAAAA[A-Za-z0-9_-]{20,}/ },
  {
    rule: "JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    rule: "hard-coded secret assignment",
    pattern:
      /\b(?:AUTH_SECRET(?:_PREVIOUS)?|RESEND_API_KEY|RESEND_WEBHOOK_SECRET|TURNSTILE_SECRET_KEY|GEMINI_API_KEY|SETUP_TOKEN|CLOUDFLARE_API_TOKEN|ORIGIN_AUTH_SECRET|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|LITESTREAM_SECRET_ACCESS_KEY)\b[ \t]*[:=][ \t]*["'`]?([A-Za-z0-9+/_=.-]{16,})/,
  },
];

/**
 * Obviously fake values used by the test suites. They are listed exactly (not by pattern) so a
 * real credential can never hide behind this list.
 */
export const KNOWN_TEST_FIXTURES: readonly string[] = [
  "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  "setup-token-for-tests-0123456789",
  "0x4AAAAAAA-real-looking-secret",
  "0x4AAAAAAA-secret",
  "short-secret-value",
];

/** Strings that only exist in server code or secrets and must never reach the browser. */
export const SERVER_ONLY_MARKERS: readonly string[] = [
  "AUTH_SECRET",
  "ORIGIN_AUTH_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "SETUP_TOKEN",
  "RESEND_API_KEY",
  "GEMINI_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "RESEND_WEBHOOK_SECRET",
  "x-goog-api-key",
  "api.resend.com",
  "generativelanguage.googleapis.com",
  "pwnedpasswords",
  "argon2",
  "password_hash",
  "hashPassword",
  "hmacHex",
  "drizzle",
  "d1_migrations",
  "INSERT INTO",
];

export function findSecrets(text: string): string[] {
  const rules: string[] = [];
  for (const { rule, pattern } of SECRET_PATTERNS) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    for (const match of text.matchAll(global)) {
      const value = match[1] ?? match[0];
      if (KNOWN_TEST_FIXTURES.some((fixture) => value.includes(fixture) || fixture.includes(value)))
        continue;
      rules.push(rule);
      break;
    }
  }
  return rules;
}

const TEXT_FILE =
  /\.(?:[cm]?[jt]sx?|json|jsonc|md|txt|html|css|sql|toml|ya?ml|sh|env|example|vars)$|^\.[^/]+$/;

export function scanFiles(root: string, files: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const name = file.split("/").pop() ?? file;
    if (!TEXT_FILE.test(name)) continue;
    const full = join(root, file);
    if (!existsSync(full) || statSync(full).size > 2_000_000) continue;
    for (const rule of findSecrets(readFileSync(full, "utf8"))) findings.push({ file, rule });
  }
  return findings;
}

/**
 * Never committed (mirrors .gitignore) — used when the project is not a git checkout, e.g. an
 * unzipped copy. Local secret files are excluded on purpose: they are SUPPOSED to hold secrets.
 */
const NOT_COMMITTED = new Set([
  "node_modules",
  ".git",
  ".wrangler",
  ".vora",
  "build",
  ".react-router",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
  "backups",
]);
const LOCAL_SECRET_FILE = /^\.(?:dev\.vars|env)(?:\..+)?$/;

/** Files git would commit: tracked plus untracked-but-not-ignored (or the same rules without git). */
export function repositoryFiles(root: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean);
  } catch {
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(join(root, dir))) {
        const rel = dir ? `${dir}/${name}` : name;
        if (NOT_COMMITTED.has(name)) continue;
        if (LOCAL_SECRET_FILE.test(name) && !name.endsWith(".example")) continue;
        if (statSync(join(root, rel)).isDirectory()) visit(rel);
        else files.push(rel);
      }
    };
    visit("");
    return files;
  }
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

/** Reads secret VALUES (not names) from dotenv-style files; short/empty values are ignored. */
export function secretValuesFrom(envFiles: readonly string[]): string[] {
  const values: string[] = [];
  for (const file of envFiles) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
      const value = match?.[2]?.trim() ?? "";
      if (value.length >= 16) values.push(value);
    }
  }
  return values;
}

export function scanClientBundle(dir: string, secretValues: readonly string[] = []): Finding[] {
  const findings: Finding[] = [];
  for (const full of walk(dir)) {
    const file = relative(dir, full);
    if (file.endsWith(".map")) {
      findings.push({ file, rule: "source map published" });
      continue;
    }
    if (!/\.(?:m?js|css|html|json|txt|svg)$/.test(file)) continue;
    const text = readFileSync(full, "utf8");
    for (const marker of SERVER_ONLY_MARKERS) {
      if (text.includes(marker)) findings.push({ file, rule: `server-only marker "${marker}"` });
    }
    for (const value of secretValues) {
      if (text.includes(value)) findings.push({ file, rule: "secret value from env file" });
    }
    for (const rule of findSecrets(text)) findings.push({ file, rule });
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const values = (name: string) =>
    args.flatMap((arg, i) => (arg === name && args[i + 1] ? [args[i + 1] as string] : []));
  const root = process.cwd();

  const files = repositoryFiles(root);
  const repoFindings = scanFiles(root, files);
  console.log(`Repository: ${files.length} committable files scanned.`);

  let bundleFindings: Finding[] = [];
  for (const dir of values("--bundle")) {
    if (!existsSync(dir)) {
      console.log(`Bundle: ${dir} not found (run a build first) — skipped.`);
      continue;
    }
    bundleFindings = bundleFindings.concat(
      scanClientBundle(dir, secretValuesFrom(values("--secrets-from"))),
    );
    console.log(`Bundle: ${walk(dir).length} files in ${dir} scanned.`);
  }

  const all = [
    ...repoFindings.map((f) => `repository  ${f.file}: ${f.rule}`),
    ...bundleFindings.map((f) => `bundle      ${f.file}: ${f.rule}`),
  ];
  if (all.length > 0) {
    console.error(`\n${all.length} finding(s):\n${all.join("\n")}`);
    process.exit(1);
  }
  console.log("No findings.");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
