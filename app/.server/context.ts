import { createContext } from "react-router";
import type { Actor, PendingSession } from "./auth/types";
import { type AppConfig, getConfig, type WorkerEnv } from "./config/env";
import { createDb, type Database } from "./db/client";
import { getRequestMeta, type RequestMeta } from "./lib/request-meta";
import { type Clock, systemClock } from "./lib/time";
import { createLogger, type Logger } from "./observability/logger";

/**
 * Per-request server context: configuration, database, clock, logger and request facts.
 * Created once by the kernel and shared by API handlers, React Router loaders/actions and
 * services, so every layer sees the same request ID and settings.
 */
export interface ServerContext {
  env: WorkerEnv;
  config: AppConfig;
  db: Database;
  clock: Clock;
  log: Logger;
  requestId: string;
  meta: RequestMeta;
  /** Keeps background work (email delivery, logging) alive after the response is sent. */
  waitUntil(promise: Promise<unknown>): void;
}

export function createServerContext(input: {
  env: WorkerEnv;
  request: Request;
  requestId: string;
  waitUntil: (promise: Promise<unknown>) => void;
  clock?: Clock;
}): ServerContext {
  const config = getConfig(input.env);
  const url = new URL(input.request.url);
  return {
    env: input.env,
    config,
    db: createDb(input.env.DB),
    clock: input.clock ?? systemClock,
    log: createLogger(
      { requestId: input.requestId, method: input.request.method, path: url.pathname },
      config.logLevel,
    ),
    requestId: input.requestId,
    meta: getRequestMeta(input.request),
    waitUntil: input.waitUntil,
  };
}

/** Context for non-request work (cron jobs, scripts). */
export function createJobContext(input: {
  env: WorkerEnv;
  job: string;
  waitUntil: (promise: Promise<unknown>) => void;
  clock?: Clock;
}): ServerContext {
  const config = getConfig(input.env);
  const requestId = `job:${input.job}:${crypto.randomUUID()}`;
  return {
    env: input.env,
    config,
    db: createDb(input.env.DB),
    clock: input.clock ?? systemClock,
    log: createLogger({ requestId, job: input.job }, config.logLevel),
    requestId,
    meta: {
      ip: "0.0.0.0",
      ipPrefix: "internal",
      userAgent: "vora-scheduler",
      country: null,
      region: null,
      city: null,
      asn: null,
    },
    waitUntil: input.waitUntil,
  };
}

/** What React Router loaders and actions receive through `context.get(appContext)`. */
export interface AppLoadContext {
  server: ServerContext;
  /** Fully signed-in actor (2FA satisfied where required), or null. */
  actor: Actor | null;
  /** A password-verified session still waiting for its 2FA code, or null. */
  pending: PendingSession | null;
  /** Per-request CSP nonce for inline/framework scripts. */
  cspNonce: string;
}

export const appContext = createContext<AppLoadContext>();
