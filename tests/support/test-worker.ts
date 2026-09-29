import type { WorkerEnv } from "~/.server/config/env";
import { appContext } from "~/.server/context";
import { createKernel } from "~/.server/kernel/app";

// wrangler.jsonc binds PASSWORD_HASHER to a class in the main module, so the test entry exports it
// too (CP-3 · Free plan). Integration tests therefore hash through the real Durable Object.
export { PasswordHasher } from "~/.server/auth/password-hasher";

/**
 * Test entry: the production kernel (headers, CSRF, sessions, maintenance, API) with a stub page
 * renderer standing in for React Router. The stub echoes what the kernel resolved so tests can
 * assert on session/actor resolution for page requests.
 */
export const kernel = createKernel({
  renderPage: async (_request, context) => {
    const { actor, pending } = context.get(appContext);
    const body = `<!doctype html><title>page</title><p data-actor="${actor?.userId ?? ""}" data-pending="${pending?.userId ?? ""}">page</p>`;
    return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    return kernel.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<WorkerEnv>;
