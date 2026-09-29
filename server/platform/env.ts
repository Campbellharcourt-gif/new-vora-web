import type { WorkerEnv } from "../../app/.server/config/env";
import type { ObjectStorage } from "../../app/.server/platform/types";
import { type PlatformConfig, pickAppVariables } from "./config";
import { MemoryMailbox } from "./mailbox";
import { createLimiters, type LimiterSet } from "./rate-limiter";
import type { SqliteDatabase } from "./sqlite";
import { MemoryStorage, R2Storage } from "./storage";

/**
 * Builds the object the application receives as its environment (WorkerEnv): the services the
 * Workers bindings used to provide, plus the plain variables and secrets the application reads.
 */
export interface PlatformServices {
  db: SqliteDatabase;
  media: ObjectStorage;
  private: ObjectStorage;
  limiters: LimiterSet;
  mailbox: MemoryMailbox | null;
}

export function createServices(config: PlatformConfig, db: SqliteDatabase): PlatformServices {
  let media: ObjectStorage;
  let privateFiles: ObjectStorage;
  if (config.r2) {
    const base = {
      accountId: config.r2.accountId,
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
      ...(config.r2.endpoint ? { endpoint: config.r2.endpoint } : {}),
    };
    media = new R2Storage({ ...base, bucket: config.r2.mediaBucket });
    privateFiles = new R2Storage({ ...base, bucket: config.r2.privateBucket });
  } else if (config.productionLike) {
    // Unreachable: platform config validation requires R2 in staging/production.
    throw new Error("R2 storage is required in staging/production");
  } else {
    media = new MemoryStorage();
    privateFiles = new MemoryStorage();
  }
  return {
    db,
    media,
    private: privateFiles,
    limiters: createLimiters(),
    // The dev mailbox exists only in development and test — never in staging/production.
    mailbox: config.productionLike ? null : new MemoryMailbox(),
  };
}

export function buildWorkerEnv(
  vars: Record<string, string | undefined>,
  services: PlatformServices,
  migrations: readonly string[],
): WorkerEnv {
  const env: WorkerEnv = {
    ...(pickAppVariables(vars) as Omit<WorkerEnv, "DB" | "MEDIA" | "PRIVATE" | `RL_${string}`>),
    APP_ENV: vars.APP_ENV ?? "",
    APP_ORIGIN: vars.APP_ORIGIN ?? "",
    DB: services.db,
    MEDIA: services.media,
    PRIVATE: services.private,
    RL_AUTH: services.limiters.RL_AUTH,
    RL_FORMS: services.limiters.RL_FORMS,
    RL_API: services.limiters.RL_API,
    RL_AI: services.limiters.RL_AI,
    MIGRATIONS: migrations,
  };
  if (services.mailbox) env.DEV_MAILBOX = services.mailbox;
  return env;
}
