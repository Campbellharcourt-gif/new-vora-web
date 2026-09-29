import { readFileSync } from "node:fs";
import { isTurnstileTestKey } from "@shared/turnstile";
import { describe, expect, it } from "vitest";
import { readJsonc } from "../../scripts/lib/jsonc";
import { REQUIRED_SECRETS } from "../../scripts/predeploy-check";

/**
 * CP-2.1 deployment-safety rules that can be read straight from the repository:
 * H1 (no Turnstile test keys), H2 + H4 (deploy script order and flags) and H3 (declared secrets).
 */

interface Section {
  name?: string;
  vars?: Record<string, string>;
  secrets?: { required?: string[] };
}
const config = readJsonc<Section & { env: { staging: Section; production: Section } }>(
  "wrangler.jsonc",
);
const scripts = (
  JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
).scripts;
const OPTIONAL_SECRETS = [
  "SETUP_TOKEN",
  "GEMINI_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "AUTH_SECRET_PREVIOUS",
];

describe("wrangler.jsonc", () => {
  for (const name of ["staging", "production"] as const) {
    it(`${name}: never uses a Cloudflare Turnstile test site key (H1)`, () => {
      expect(isTurnstileTestKey(config.env[name].vars?.TURNSTILE_SITE_KEY)).toBe(false);
    });

    it(`${name}: declares exactly the secrets a deploy must find (H3)`, () => {
      expect([...(config.env[name].secrets?.required ?? [])].sort()).toEqual(
        [...REQUIRED_SECRETS].sort(),
      );
      for (const optional of OPTIONAL_SECRETS) {
        // SETUP_TOKEN in particular must stay deletable after /setup without breaking deploys.
        expect(config.env[name].secrets?.required, optional).not.toContain(optional);
      }
    });
  }

  it("keeps secret declarations out of the local configuration (local .dev.vars keep loading)", () => {
    expect(config.secrets).toBeUndefined();
  });
});

describe("deploy scripts", () => {
  for (const name of ["staging", "production"] as const) {
    for (const variant of ["", ":dry-run"] as const) {
      const key = `deploy:${name}${variant}`;
      it(`${key}: build → security scan → pre-deploy check → wrangler deploy, no provisioning (H2, H4)`, () => {
        const script = scripts[key] ?? "";
        const steps = [
          `CLOUDFLARE_ENV=${name} react-router build`,
          "npm run security:scan",
          `tsx scripts/predeploy-check.ts --env ${name}`,
          "wrangler deploy",
        ];
        const positions = steps.map((step) => script.indexOf(step));
        expect(positions, script).not.toContain(-1);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        const deploy = script.slice(script.indexOf("wrangler deploy"));
        expect(deploy).toContain("--experimental-provision=false");
        // Never `--env` on the deploy itself: the build already fixed the environment.
        expect(deploy).not.toMatch(/--env\b|\s-e\s/);
        expect(script.match(/wrangler deploy/g)).toHaveLength(1);
        expect(deploy.includes("--dry-run")).toBe(variant === ":dry-run");
      });
    }
  }

  it("production still asks for the typed confirmation before anything else", () => {
    expect(
      scripts["deploy:production"]?.startsWith('node scripts/confirm.mjs "Deploy to PRODUCTION"'),
    ).toBe(true);
  });
});
