import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import type { WorkerEnv } from "../app/.server/config/env";
import type { AppModule } from "./app";
import { BackgroundTasks } from "./platform/background";
import { type PlatformConfig, PlatformConfigError, readPlatformConfig } from "./platform/config";
import { buildWorkerEnv, createServices, type PlatformServices } from "./platform/env";
import { startLimiterSweeps } from "./platform/rate-limiter";
import { JobScheduler } from "./platform/scheduler";
import {
  describePath,
  integrityCheck,
  MigrationError,
  migrate,
  openDatabase,
  readMigrations,
  type SqliteDatabase,
} from "./platform/sqlite";
import { StaticFiles } from "./platform/static";
import {
  CloudflareAccessVerifier,
  denyResponse,
  type TrustConfig,
  trustRequest,
} from "./platform/trust";

/**
 * Start-up and shutdown of the Node server (Railway migration §4.2, §4.7):
 *
 *  1. validate configuration (platform + application) — refuse to start on any problem
 *  2. open SQLite (foreign_keys=ON, WAL, busy_timeout) and check its integrity
 *  3. apply pending migrations (snapshot first; stop on any error)
 *  4. Argon2id self-test (known answer) — refuse to start if absent or wrong
 *  5. build the platform env (database, storage, rate limiters, dev mailbox)
 *  6. HTTP: trust gate → static files → kernel (React Router SSR, API, webhooks)
 *  7. scheduler: `*\/5` email retry · `17 3 * * *` daily (UTC, no overlap)
 *  8. SIGTERM: stop accepting · stop the scheduler · finish requests and background tasks
 *     (bounded) · close the database · exit 0
 */

type Kernel = ReturnType<AppModule["createAppKernel"]>;
type Logger = ReturnType<AppModule["createLogger"]>;

export interface StartOptions {
  vars: Record<string, string | undefined>;
  /** The application module (bundled in production; loaded through Vite in development). */
  app: AppModule;
  /** Development: the kernel is re-created when Vite reloads the application. */
  kernel?: () => Promise<Kernel>;
  /** `build/client`, or null when Vite serves client files (development). */
  staticRoot: string | null;
  migrationsDir: string;
  defaultDatabasePath: string;
  devServer?: boolean;
  /** Development: Vite's middlewares, run before the application. */
  middleware?: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  /** Called with the HTTP server before it listens (development: Vite's HMR socket). */
  onServer?: (server: Server) => void;
  /** Install SIGTERM/SIGINT handlers (off in tests that drive shutdown themselves). */
  handleSignals?: boolean;
  /** Exit the process after shutdown (off in tests). */
  exitOnShutdown?: boolean;
  /** Where the one-line JSON logs go (default: stdout/stderr). Tests capture them. */
  logWrite?: (stream: "stdout" | "stderr", text: string) => void;
}

export interface RunningServer {
  server: Server;
  url: string;
  env: WorkerEnv;
  config: PlatformConfig;
  services: PlatformServices;
  scheduler: JobScheduler;
  background: BackgroundTasks;
  activeRequests(): number;
  shutdown(reason?: string): Promise<{ clean: boolean }>;
}

export class StartupError extends Error {
  constructor(
    readonly step: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StartupError";
  }
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const { app, vars } = options;
  app.setLogSink(app.jsonLineSink(options.logWrite));
  const log: Logger = app.createLogger(
    { component: "server" },
    (["debug", "info", "warn", "error"] as const).find((l) => l === vars.LOG_LEVEL) ?? "info",
  );

  // 1. Platform configuration.
  let config: PlatformConfig;
  try {
    config = readPlatformConfig(vars, { databasePath: options.defaultDatabasePath });
  } catch (error) {
    const keys = error instanceof PlatformConfigError ? error.invalidKeys : [String(error)];
    log.error("configuration_invalid", { scope: "platform", invalidKeys: keys });
    throw new StartupError("configuration", "Invalid platform configuration", { cause: error });
  }

  // 2. Database.
  let db: SqliteDatabase;
  try {
    db = await openDatabase({ path: config.databasePath });
  } catch (error) {
    log.error("database_open_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new StartupError("database", "Could not open the database", { cause: error });
  }
  const integrity = await integrityCheck(db);
  if (integrity.quickCheck !== "ok") {
    db.close();
    log.error("database_integrity_failed", { quickCheck: integrity.quickCheck.slice(0, 500) });
    throw new StartupError("database", "SQLite quick_check failed");
  }

  // 3. Migrations.
  const migrations = readMigrations(options.migrationsDir);
  if (migrations.length === 0) {
    db.close();
    throw new StartupError("migrations", `No migrations found in ${options.migrationsDir}`);
  }
  try {
    const report = await migrate(db, migrations);
    log.info("migrations_checked", {
      database: describePath(config.databasePath),
      applied: report.applied,
      total: migrations.length,
      snapshot: report.snapshot ? describePath(report.snapshot) : null,
    });
  } catch (error) {
    db.close();
    log.error("migration_failed", {
      migration: error instanceof MigrationError ? error.migration : null,
      snapshot:
        error instanceof MigrationError && error.snapshot ? describePath(error.snapshot) : null,
      error:
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : String(error),
    });
    throw new StartupError("migrations", "A migration failed", { cause: error });
  }

  // 4. Argon2id.
  try {
    await app.argon2SelfTest();
  } catch (error) {
    db.close();
    log.error("argon2_self_test_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new StartupError("argon2", "Argon2id self-test failed", { cause: error });
  }

  // 5. Platform env + application configuration.
  const services = createServices(config, db);
  const env = buildWorkerEnv(
    vars,
    services,
    migrations.map((m) => m.name),
  );
  try {
    app.getConfig(env);
  } catch (error) {
    db.close();
    const internal = (error as { internal?: { invalidKeys?: string[] } }).internal;
    log.error("configuration_invalid", {
      scope: "application",
      invalidKeys: internal?.invalidKeys ?? [String(error)],
    });
    throw new StartupError("configuration", "Invalid application configuration", { cause: error });
  }

  // 6. HTTP.
  const background = new BackgroundTasks((error) =>
    log.error("background_task_failed", {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  const staticFiles = options.staticRoot ? new StaticFiles(options.staticRoot) : null;
  const trust: TrustConfig = {
    appOrigin: app.getConfig(env).origin,
    enforceOriginAuth: config.productionLike,
    originAuthSecret: config.originAuthSecret,
    access: config.access ? new CloudflareAccessVerifier(config.access) : null,
  };
  let fixedKernel: Kernel | null = null;
  const kernelFor = async (): Promise<Kernel> => {
    if (options.kernel) return options.kernel();
    fixedKernel ??= app.createAppKernel({ devServer: options.devServer ?? false });
    return fixedKernel;
  };

  const denials = { windowStart: 0, count: 0 };
  const logDenied = (reason: string, path: string, status: number) => {
    const now = Date.now();
    if (now - denials.windowStart > 60_000) {
      denials.windowStart = now;
      denials.count = 0;
    }
    denials.count += 1;
    // Bounded: a flood of direct hits must not flood the logs (Railway caps 500 lines/s).
    if (denials.count <= 20) log.warn("request_refused", { reason, path, status });
  };

  const listener = getRequestListener(
    async (request, bindings) => {
      const socket = "incoming" in bindings ? bindings.incoming.socket?.remoteAddress : undefined;
      const decision = await trustRequest(request, socket, trust);
      if (decision.kind === "deny") {
        logDenied(decision.reason, decision.path, decision.status);
        return denyResponse(decision.status);
      }
      const asset = staticFiles?.respond(decision.request, decision.path);
      if (asset) return asset;
      const kernel = await kernelFor();
      return kernel.fetch(decision.request, env, background.context());
    },
    {
      overrideGlobalObjects: false,
      errorHandler: (error) => {
        log.error("request_adapter_error", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response("Bad request\n", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
    },
  );

  let active = 0;
  const server = createServer((req, res) => {
    active += 1;
    res.once("close", () => {
      active -= 1;
    });
    if (options.middleware) options.middleware(req, res, () => void listener(req, res));
    else void listener(req, res);
  });
  // Longer than a typical proxy idle timeout, so a reused upstream connection is never cut.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;
  options.onServer?.(server);

  // 7. Scheduler.
  const scheduler = new JobScheduler(
    app.JOB_SCHEDULES,
    (controller) => app.runScheduled(controller, env, background.context()),
    log,
  );
  const stopSweeps = startLimiterSweeps(services.limiters);

  const listen = (host: string) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  try {
    // "::" (the default) accepts IPv4 and IPv6, which Railway's networking uses.
    await listen(config.host);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (config.host !== "::" || (code !== "EAFNOSUPPORT" && code !== "EADDRNOTAVAIL")) throw error;
    log.warn("ipv6_unavailable", { fallback: "0.0.0.0" });
    await listen("0.0.0.0");
  }
  if (vars.SCHEDULER !== "off") scheduler.start();
  const address = server.address() as AddressInfo;
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  const url = `http://${host}:${address.port}`;
  log.info("server_listening", {
    port: address.port,
    appEnv: config.appEnv,
    originAuth: trust.enforceOriginAuth,
    access: trust.access !== null,
    staticFiles: staticFiles?.count ?? 0,
    storage: config.r2 ? "r2" : "memory",
  });

  // 8. Shutdown.
  let shuttingDown: Promise<{ clean: boolean }> | null = null;
  const shutdown = (reason = "SIGTERM"): Promise<{ clean: boolean }> => {
    shuttingDown ??= (async () => {
      const deadline = Date.now() + config.shutdownTimeoutMs;
      const remaining = () => Math.max(0, deadline - Date.now());
      log.info("shutdown_started", { reason, activeRequests: active, background: background.size });
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      const schedulerStopped = await scheduler.stop(remaining());
      while (active > 0 && remaining() > 0) {
        await new Promise((r) => setTimeout(r, 25));
        server.closeIdleConnections();
      }
      const requestsDone = active === 0;
      const tasksDone = await background.drain(remaining());
      if (!requestsDone) server.closeAllConnections();
      await Promise.race([closed, new Promise((r) => setTimeout(r, 1_000))]);
      stopSweeps();
      db.close();
      const clean = schedulerStopped && requestsDone && tasksDone;
      log.info("shutdown_complete", { clean, schedulerStopped, requestsDone, tasksDone });
      return { clean };
    })();
    return shuttingDown;
  };

  if (options.handleSignals !== false) {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        void shutdown(signal).then(() => {
          if (options.exitOnShutdown !== false) process.exit(0);
        });
      });
    }
    process.on("unhandledRejection", (error) => {
      log.error("unhandled_rejection", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return {
    server,
    url,
    env,
    config,
    services,
    scheduler,
    background,
    activeRequests: () => active,
    shutdown,
  };
}
