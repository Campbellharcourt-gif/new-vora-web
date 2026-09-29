import { createRequestHandler } from "react-router";
import { createKernel } from "../app/.server/kernel/app";

/**
 * The application as the Node server sees it (Railway migration §4.2). This module is the one
 * that imports the React Router server build, so it is loaded through Vite: bundled into
 * `build/server/index.js` for production (via server/main.ts), and through `ssrLoadModule` by the
 * development server (server/dev.ts). Everything the runtime needs from the application is
 * re-exported here, so the runtime and the application always share one module instance (one
 * log sink, one configuration cache, one password-hashing queue).
 */

export { argon2SelfTest } from "../app/.server/auth/password";
export { getConfig } from "../app/.server/config/env";
export { JOB_SCHEDULES, runScheduled } from "../app/.server/jobs/scheduled";
export { createLogger, jsonLineSink, setLogSink } from "../app/.server/observability/logger";

export function createAppKernel(options: { devServer: boolean }) {
  const handleReactRouter = createRequestHandler(
    () => import("virtual:react-router/server-build"),
    import.meta.env.MODE,
  );
  return createKernel({
    renderPage: (request, context) => handleReactRouter(request, context),
    devServer: options.devServer,
  });
}

export type AppModule = typeof import("./app");
