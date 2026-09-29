import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { MIN_ORIGIN_SECRET_LENGTH } from "./trust";

/**
 * Platform configuration (Railway migration §4.10): the variables the Node server itself needs,
 * validated at start-up. It fails closed exactly like the application's own validation
 * (app/.server/config/env.ts), which the server also runs before it listens:
 *
 * - staging and production refuse to start without `ORIGIN_AUTH_SECRET` (32+ characters),
 *   `DATABASE_PATH`, and the R2 settings;
 * - staging refuses to start without the Cloudflare Access settings (decision D22);
 * - the Access settings come as a pair or not at all.
 *
 * Values are never logged — only the names of the variables that are wrong.
 */

const APP_ENVS = ["development", "test", "staging", "production"] as const;
const blank = (v: string | undefined) => v === undefined || v.trim().length === 0;

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

const schema = z
  .object({
    APP_ENV: z.enum(APP_ENVS),
    // 0 = any free port (tests); Railway always provides one.
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().min(1).default("::"),
    DATABASE_PATH: z.string().optional(),
    ORIGIN_AUTH_SECRET: z.string().optional(),
    CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
    CF_ACCESS_AUD: z.string().optional(),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_BUCKET_MEDIA: z.string().optional(),
    R2_BUCKET_PRIVATE: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(25_000),
  })
  .superRefine((env, ctx) => {
    const prodLike = env.APP_ENV === "staging" || env.APP_ENV === "production";
    const need = (key: keyof typeof env, message = "required in staging/production") => {
      if (blank(env[key] as string | undefined))
        ctx.addIssue({ code: "custom", path: [key], message });
    };
    if (prodLike) {
      need("DATABASE_PATH");
      if (!blank(env.DATABASE_PATH) && !isAbsolute(env.DATABASE_PATH as string)) {
        ctx.addIssue({ code: "custom", path: ["DATABASE_PATH"], message: "must be absolute" });
      }
      if (blank(env.ORIGIN_AUTH_SECRET)) {
        ctx.addIssue({ code: "custom", path: ["ORIGIN_AUTH_SECRET"], message: "required" });
      } else if ((env.ORIGIN_AUTH_SECRET as string).trim().length < MIN_ORIGIN_SECRET_LENGTH) {
        ctx.addIssue({
          code: "custom",
          path: ["ORIGIN_AUTH_SECRET"],
          message: `must be at least ${MIN_ORIGIN_SECRET_LENGTH} characters`,
        });
      }
      for (const key of [
        "R2_ACCOUNT_ID",
        "R2_BUCKET_MEDIA",
        "R2_BUCKET_PRIVATE",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
      ] as const)
        need(key);
      // A loopback override exists only for local production-mode rehearsals (the HTTPS E2E
      // suite runs a local S3 mock). Anything else in staging/production is refused.
      if (!blank(env.R2_ENDPOINT) && !isLoopbackUrl(env.R2_ENDPOINT as string)) {
        ctx.addIssue({
          code: "custom",
          path: ["R2_ENDPOINT"],
          message: "only a loopback address (local rehearsals) is allowed in staging/production",
        });
      }
    }
    if (env.APP_ENV === "staging") {
      need("CF_ACCESS_TEAM_DOMAIN", "required in staging (Cloudflare Access, decision D22)");
      need("CF_ACCESS_AUD", "required in staging (Cloudflare Access, decision D22)");
    }
    if (blank(env.CF_ACCESS_TEAM_DOMAIN) !== blank(env.CF_ACCESS_AUD)) {
      ctx.addIssue({
        code: "custom",
        path: ["CF_ACCESS_AUD"],
        message: "set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD together",
      });
    }
    if (
      !prodLike &&
      !blank(env.R2_ACCOUNT_ID) &&
      (blank(env.R2_ACCESS_KEY_ID) || blank(env.R2_SECRET_ACCESS_KEY))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["R2_ACCESS_KEY_ID"],
        message: "incomplete R2 settings",
      });
    }
  });

export interface PlatformConfig {
  appEnv: (typeof APP_ENVS)[number];
  productionLike: boolean;
  port: number;
  host: string;
  databasePath: string;
  originAuthSecret: string | null;
  access: { teamDomain: string; audience: string } | null;
  r2: {
    accountId: string;
    mediaBucket: string;
    privateBucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
  } | null;
  shutdownTimeoutMs: number;
}

export class PlatformConfigError extends Error {
  constructor(readonly invalidKeys: string[]) {
    super(`Invalid platform configuration: ${invalidKeys.join("; ")}`);
    this.name = "PlatformConfigError";
  }
}

export function readPlatformConfig(
  vars: Record<string, string | undefined>,
  defaults: { databasePath: string },
): PlatformConfig {
  const parsed = schema.safeParse(vars);
  if (!parsed.success) {
    throw new PlatformConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const productionLike = e.APP_ENV === "staging" || e.APP_ENV === "production";
  const trimmed = (v: string | undefined) => (blank(v) ? null : (v as string).trim());
  const r2Account = trimmed(e.R2_ACCOUNT_ID);
  return {
    appEnv: e.APP_ENV,
    productionLike,
    port: e.PORT,
    host: e.HOST,
    databasePath: trimmed(e.DATABASE_PATH) ?? resolve(defaults.databasePath),
    originAuthSecret: trimmed(e.ORIGIN_AUTH_SECRET),
    access:
      trimmed(e.CF_ACCESS_TEAM_DOMAIN) && trimmed(e.CF_ACCESS_AUD)
        ? {
            teamDomain: trimmed(e.CF_ACCESS_TEAM_DOMAIN) as string,
            audience: trimmed(e.CF_ACCESS_AUD) as string,
          }
        : null,
    r2: r2Account
      ? {
          accountId: r2Account,
          mediaBucket: trimmed(e.R2_BUCKET_MEDIA) ?? "",
          privateBucket: trimmed(e.R2_BUCKET_PRIVATE) ?? "",
          accessKeyId: trimmed(e.R2_ACCESS_KEY_ID) ?? "",
          secretAccessKey: trimmed(e.R2_SECRET_ACCESS_KEY) ?? "",
          ...(trimmed(e.R2_ENDPOINT) ? { endpoint: trimmed(e.R2_ENDPOINT) as string } : {}),
        }
      : null,
    shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS,
  };
}

/**
 * The variables the application reads (WorkerEnv's string fields). Only these are copied into the
 * env object the application sees: platform secrets (origin auth, R2 credentials) never reach it.
 */
export const APP_VARIABLES = [
  "APP_ENV",
  "APP_ORIGIN",
  "APP_NAME",
  "EMAIL_TRANSPORT",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "TEAM_NOTIFY_EMAIL",
  "CAREERS_NOTIFY_EMAIL",
  "TURNSTILE_SITE_KEY",
  "AI_GATEWAY_BASE_URL",
  "MAINTENANCE_MODE",
  "LOG_LEVEL",
  "AUTH_SECRET",
  "AUTH_SECRET_PREVIOUS",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
  "GEMINI_API_KEY",
  "SETUP_TOKEN",
] as const;

export function pickAppVariables(
  vars: Record<string, string | undefined>,
): Record<(typeof APP_VARIABLES)[number], string | undefined> {
  const out = {} as Record<(typeof APP_VARIABLES)[number], string | undefined>;
  for (const key of APP_VARIABLES) {
    const value = vars[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
