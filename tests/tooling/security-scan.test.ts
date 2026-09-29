import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findSecrets,
  KNOWN_TEST_FIXTURES,
  repositoryFiles,
  scanClientBundle,
  scanFiles,
  secretValuesFrom,
} from "../../scripts/security-scan";

/** Planted credentials are assembled at runtime so this file never contains one itself. */
const planted = {
  google: `AIza${"S".repeat(35)}`,
  resend: `re_${"a1b2c3d4"}_${"Q".repeat(24)}`,
  aws: `AKIA${"ABCDEFGHIJKLMNOP"}`,
  github: `ghp_${"x".repeat(36)}`,
  turnstile: `0x4AAAAAAA${"B".repeat(24)}`,
  key: `-----BEGIN ${"PRIVATE"} KEY-----`,
};

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vora-scan-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("repository secret scan", () => {
  it("detects each credential shape", () => {
    expect(findSecrets(`const k = "${planted.google}";`)).toEqual(["Google API key"]);
    expect(findSecrets(`RESEND=${planted.resend}`)).toEqual(["Resend API key"]);
    expect(findSecrets(planted.aws)).toEqual(["AWS access key"]);
    expect(findSecrets(planted.github)).toEqual(["GitHub token"]);
    expect(findSecrets(planted.key)).toEqual(["private key"]);
    expect(findSecrets(`x = "${planted.turnstile}"`)).toContain("Turnstile secret");
    expect(findSecrets(`AUTH_SECRET=${"z".repeat(40)}`)).toEqual(["hard-coded secret assignment"]);
    expect(findSecrets(`GEMINI_API_KEY: "${"y".repeat(30)}"`)).toEqual([
      "hard-coded secret assignment",
    ]);
  });

  it("ignores empty examples, references and the listed test fixtures only", () => {
    expect(findSecrets("AUTH_SECRET=\n# comment on the next line that is long enough")).toEqual([]);
    expect(findSecrets("npx wrangler secret put AUTH_SECRET --env production")).toEqual([]);
    expect(findSecrets("const secret = ctx.config.authSecrets[0];")).toEqual([]);
    for (const fixture of KNOWN_TEST_FIXTURES) {
      expect(findSecrets(`AUTH_SECRET: "${fixture}"`), fixture).toEqual([]);
    }
    // A real-looking value is still caught even next to a fixture.
    expect(
      findSecrets(`AUTH_SECRET: "${KNOWN_TEST_FIXTURES[0]}"\nSETUP_TOKEN: "${"k".repeat(32)}"`),
    ).toEqual(["hard-coded secret assignment"]);
  });

  it("reports the file and rule, never the secret", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.ts"), `export const key = "${planted.google}";\n`);
    writeFileSync(join(dir, "clean.ts"), "export const ok = true;\n");
    const findings = scanFiles(dir, ["config.ts", "clean.ts"]);
    expect(findings).toEqual([{ file: "config.ts", rule: "Google API key" }]);
    expect(JSON.stringify(findings)).not.toContain(planted.google);
  });
});

describe("committable files", () => {
  it("applies the ignore rules when the project is not a git checkout (unzipped copy)", () => {
    const dir = tempDir();
    for (const sub of ["app", "node_modules/x", ".wrangler/state", "build/client"]) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
    writeFileSync(join(dir, "app", "a.ts"), "export {};");
    writeFileSync(join(dir, ".dev.vars.example"), "AUTH_SECRET=\n");
    writeFileSync(join(dir, ".dev.vars"), "AUTH_SECRET=local\n");
    writeFileSync(join(dir, "node_modules", "x", "i.js"), "");
    writeFileSync(join(dir, ".wrangler", "state", "db"), "");
    writeFileSync(join(dir, "build", "client", "b.js"), "");
    expect(repositoryFiles(dir).sort()).toEqual([".dev.vars.example", "app/a.ts"]);
  });
});

describe("client bundle scan", () => {
  it("passes a clean bundle", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "entry.js"), "console.log('hello');");
    expect(scanClientBundle(dir, ["local-secret-value-123456"])).toEqual([]);
  });

  it("catches server code, secret values and source maps", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "assets"));
    const secret = "local-secret-value-123456";
    writeFileSync(
      join(dir, "assets", "leak.js"),
      `fetch("https://api.resend.com/emails", "${secret}")`,
    );
    writeFileSync(join(dir, "assets", "leak.js.map"), "{}");
    const rules = scanClientBundle(dir, [secret]).map((f) => `${f.file}: ${f.rule}`);
    expect(rules).toEqual(
      expect.arrayContaining([
        'assets/leak.js: server-only marker "api.resend.com"',
        "assets/leak.js: secret value from env file",
        "assets/leak.js.map: source map published",
      ]),
    );
  });

  it("reads secret values (not names) from env files", () => {
    const dir = tempDir();
    const file = join(dir, ".dev.vars");
    writeFileSync(file, `AUTH_SECRET=${"v".repeat(40)}\nEMPTY=\nSHORT=abc\n# comment\n`);
    expect(secretValuesFrom([file, join(dir, "missing")])).toEqual(["v".repeat(40)]);
  });
});

describe("security:scan command line", () => {
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const script = join(process.cwd(), "scripts", "security-scan.ts");
  const run = (cwd: string, args: string[]) =>
    spawnSync(tsx, [script, ...args], { cwd, encoding: "utf8", timeout: 60_000 });

  it("runs in a fresh unzipped copy (no git, no .dev.vars) and passes a clean tree", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "app"));
    mkdirSync(join(dir, "client"));
    writeFileSync(join(dir, "app", "a.ts"), "export const ok = true;\n");
    writeFileSync(join(dir, "client", "entry.js"), "console.log(1);\n");
    const result = run(dir, ["--bundle", "client", "--secrets-from", ".dev.vars"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("No findings.");
  });

  it("fails on a planted credential without printing it", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.ts"), `export const key = "${planted.google}";\n`);
    const result = run(dir, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("config.ts: Google API key");
    expect(`${result.stdout}${result.stderr}`).not.toContain(planted.google);
  });
});
