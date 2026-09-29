import { createRequestHandler } from "react-router";
import type { WorkerEnv } from "../app/.server/config/env";
import { runScheduled } from "../app/.server/jobs/scheduled";
import { createKernel } from "../app/.server/kernel/app";

// The Durable Object that runs Argon2id outside the Worker's request CPU budget (CP-3 · Cloudflare
// Free). Bound as PASSWORD_HASHER in wrangler.jsonc; Cloudflare needs the class exported here.
export { PasswordHasher } from "../app/.server/auth/password-hasher";

const handleReactRouter = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const kernel = createKernel({
  renderPage: (request, context) => handleReactRouter(request, context),
  devServer: import.meta.env.DEV,
});

export default {
  fetch(request, env, ctx) {
    return kernel.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller, env, ctx));
  },
} satisfies ExportedHandler<WorkerEnv>;
