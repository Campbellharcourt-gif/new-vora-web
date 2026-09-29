import { isTurnstileTestKey } from "@shared/turnstile";
import { z } from "zod";
import { AppError } from "../lib/errors";
import type { DevMailbox, ObjectStorage, RateLimiter, SqlDatabase } from "../platform/types";

/**
 * Everything the application receives from its platform: services (database, storage, rate
 * limiters, dev mailbox) and the plain variables and secrets it reads. On Railway the Node server
 * builds this object at start-up (`server/platform/env.ts`) from the service's variables — secrets
 * are sealed Railway variables, locally `.dev.vars`. Secrets are only ever read on the server.
 *
 * The name is historic (Workers); the shape is the platform-neutral one. Platform-only secrets
 * (the origin-auth secret, R2 credentials) are deliberately not part of it: the application never
 * needs them.
 */
export interface WorkerEnv {
  DB: SqlDatabase;
  MEDIA: ObjectStorage;
  PRIVATE: ObjectStorage;
  RL_AUTH: RateLimiter;
  RL_FORMS: RateLimiter;
  RL_API: RateLimiter;
  RL_AI: RateLimiter;
  /** Development/test only — absent in staging and production. */
  DEV_MAILBOX?: DevMailbox;
  /**
   * Names of the migration files shipped with this build. The server applies them all before it
   * listens; `/api/health/live` checks the ledger still lists every one.
   */
  MIGRATIONS?: readonly string[];

  APP_ENV: string;
  APP_ORIGIN: string;
  APP_NAME?: string;
  EMAIL_TRANSPORT?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  TEAM_NOTIFY_EMAIL?: string;
  CAREERS_NOTIFY_EMAIL?: string;
  TURNSTILE_SITE_KEY?: string;
  AI_GATEWAY_BASE_URL?: string;
  MAINTENANCE_MODE?: string;
  LOG_LEVEL?: string;

  AUTH_SECRET?: string;
  AUTH_SECRET_PREVIOUS?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  GEMINI_API_KEY?: string;
  SETUP_TOKEN?: string;
}

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnvName = (typeof APP_ENVS)[number];

export interface AppConfig {
  appEnv: AppEnvName;
  isProductionLike: boolean;
  origin: string;
  host: string;
  appName: string;
  authSecrets: readonly string[];
  email: {
    transport: "resend" | "capture" | "disabled";
    from: string;
    replyTo: string | null;
    teamNotify: string;
    careersNotify: string;
    resendApiKey: string | null;
    resendWebhookSecret: string | null;
  };
  turnstile: { siteKey: string | null; secretKey: string | null };
  ai: { geminiApiKey: string | null; gatewayBaseUrl: string | null };
  setupToken: string | null;
  maintenanceForced: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

const blankToNull = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : null);

const schema = z
  .object({
    APP_ENV: z.enum(APP_ENVS),
    APP_ORIGIN: z.url(),
    APP_NAME: z.string().optional(),
    EMAIL_TRANSPORT: z.enum(["resend", "capture", "disabled"]).default("disabled"),
    EMAIL_FROM: z.string().min(3).default("VORA <hello@vorawebsites.store>"),
    EMAIL_REPLY_TO: z.string().optional(),
    TEAM_NOTIFY_EMAIL: z.email().default("projects@vorawebsites.store"),
    CAREERS_NOTIFY_EMAIL: z.email().default("careers@vorawebsites.store"),
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    AI_GATEWAY_BASE_URL: z.string().optional(),
    MAINTENANCE_MODE: z.enum(["on", "off"]).default("off"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    AUTH_SECRET_PREVIOUS: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    SETUP_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const prodLike = env.APP_ENV === "staging" || env.APP_ENV === "production";
    const origin = new URL(env.APP_ORIGIN);
    if (prodLike && origin.protocol !== "https:") {
      ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "must be https" });
    }
    if (env.EMAIL_TRANSPORT === "resend" && !blankToNull(env.RESEND_API_KEY)) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required for resend" });
    }
    if (prodLike && env.EMAIL_TRANSPORT === "capture") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_TRANSPORT"],
        message: "capture transport is not allowed in staging/production",
      });
    }
    if (prodLike && !blankToNull(env.TURNSTILE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["TURNSTILE_SECRET_KEY"], message: "required" });
    }
    if (
      prodLike &&
      (!blankToNull(env.TURNSTILE_SITE_KEY) || env.TURNSTILE_SITE_KEY?.startsWith("REPLACE_"))
    ) {
      ctx.addIssue({ code: "custom", path: ["TURNSTILE_SITE_KEY"], message: "required" });
    }
    // CP-2.1 · H1: Cloudflare's test keys pass (or fail) every challenge on any hostname.
    if (prodLike && isTurnstileTestKey(env.TURNSTILE_SITE_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["TURNSTILE_SITE_KEY"],
        message: "Cloudflare test keys are not allowed in staging/production",
      });
    }
    if (prodLike && isTurnstileTestKey(env.TURNSTILE_SECRET_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET_KEY"],
        message: "Cloudflare test keys are not allowed in staging/production",
      });
    }
    if (env.SETUP_TOKEN && env.SETUP_TOKEN.length < 24) {
      ctx.addIssue({ code: "custom", path: ["SETUP_TOKEN"], message: "must be 24+ characters" });
    }
  });

const cache = new WeakMap<object, AppConfig>();

/**
 * Validates the environment once per env object (the Node server builds one at start-up and also
 * refuses to start when this throws). Invalid configuration fails closed: the kernel turns this
 * error into a generic 503 and logs which keys are wrong (never their values).
 */
export function getConfig(env: WorkerEnv): AppConfig {
  const cached = cache.get(env);
  if (cached) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new AppError("configuration_error", {
      internal: {
        invalidKeys: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
    });
  }
  const e = parsed.data;
  const origin = new URL(e.APP_ORIGIN);
  const config: AppConfig = {
    appEnv: e.APP_ENV,
    isProductionLike: e.APP_ENV === "staging" || e.APP_ENV === "production",
    origin: origin.origin,
    host: origin.host,
    appName: e.APP_NAME?.trim() || "VORA",
    authSecrets: [e.AUTH_SECRET, blankToNull(e.AUTH_SECRET_PREVIOUS)].filter(
      (s): s is string => typeof s === "string",
    ),
    email: {
      transport: e.EMAIL_TRANSPORT,
      from: e.EMAIL_FROM,
      replyTo: blankToNull(e.EMAIL_REPLY_TO),
      teamNotify: e.TEAM_NOTIFY_EMAIL,
      careersNotify: e.CAREERS_NOTIFY_EMAIL,
      resendApiKey: blankToNull(e.RESEND_API_KEY),
      resendWebhookSecret: blankToNull(e.RESEND_WEBHOOK_SECRET),
    },
    turnstile: {
      siteKey: blankToNull(e.TURNSTILE_SITE_KEY),
      secretKey: blankToNull(e.TURNSTILE_SECRET_KEY),
    },
    ai: {
      geminiApiKey: blankToNull(e.GEMINI_API_KEY),
      gatewayBaseUrl: blankToNull(e.AI_GATEWAY_BASE_URL),
    },
    setupToken: blankToNull(e.SETUP_TOKEN),
    maintenanceForced: e.MAINTENANCE_MODE === "on",
    logLevel: e.LOG_LEVEL,
  };
  cache.set(env, config);
  return config;
}

/** The current signing secret (first) — use `config.authSecrets` for verification. */
export function primarySecret(config: AppConfig): string {
  return config.authSecrets[0] as string;
}
