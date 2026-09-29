import { type Context, Hono } from "hono";
import { RouterContextProvider } from "react-router";
import { apiError } from "../api/respond";
import { createApi } from "../api/routes";
import { resolveSession } from "../auth/sessions";
import { appContext, createServerContext } from "../context";
import { randomToken } from "../lib/crypto";
import { AppError, errors } from "../lib/errors";
import { createLogger, describeError } from "../observability/logger";
import { recordSecurityEvent } from "../observability/security-events";
import { getMaintenanceState, isMaintenanceExempt } from "../services/maintenance";
import { applySecurityHeaders } from "./headers";
import { maintenancePage, unavailablePage } from "./pages";
import type { KernelEnv } from "./types";

export type PageRenderer = (request: Request, context: RouterContextProvider) => Promise<Response>;

export interface KernelOptions {
  renderPage: PageRenderer;
  /** True when running under the Vite dev server (CSP becomes report-only for HMR). */
  devServer?: boolean;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Routes from the previous site (Mark4) that no longer exist. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/plans": "/services",
  "/start-a-project": "/contact",
  "/founders": "/our-story",
  "/process": "/our-story",
  "/cookie-policy": "/cookies",
  "/portal": "/client",
  "/faq": "/contact",
  "/help": "/contact",
};

/**
 * Log level for the per-request line (CP-2.1 · O-1). Genuine server failures are errors; the
 * planned maintenance 503 is expected behaviour, logged at info with `maintenance: true` so it
 * cannot trip error alerts while maintenance is switched on.
 */
export function requestLogLevel(status: number, maintenance: boolean): "info" | "error" {
  return status >= 500 && !maintenance ? "error" : "info";
}

/**
 * CSRF gate: a state-changing request must come from our own origin. Browsers always send
 * `Origin` on cross-site POSTs and `Sec-Fetch-Site` on modern engines; both are unforgeable by
 * page scripts. Combined with SameSite=Lax session cookies this blocks cross-site form posts.
 */
export function isSameOriginRequest(request: Request): boolean {
  const url = new URL(request.url);
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  const origin = request.headers.get("origin");
  if (origin) return origin === url.origin;
  // No Origin and no Sec-Fetch-Site: not a browser form/fetch from another site. Allow only
  // when there is also no cookie, i.e. no ambient credentials to abuse.
  return !site && !request.headers.get("cookie");
}

export function createKernel(options: KernelOptions) {
  const app = new Hono<KernelEnv>();

  // 1. Request context, logging, security headers, last-resort error handling.
  app.use("*", async (c, next) => {
    const ray = c.req.header("cf-ray");
    const requestId = ray && /^[0-9a-f]{16}(-[A-Z]{3,4})?$/i.test(ray) ? ray : crypto.randomUUID();
    const started = Date.now();
    const url = new URL(c.req.url);
    try {
      const server = createServerContext({
        env: c.env,
        request: c.req.raw,
        requestId,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });
      c.set("server", server);
      c.set("actor", null);
      c.set("pending", null);
      c.set("nonce", randomToken(16));
      c.set("maintenance", false);
    } catch (error) {
      createLogger({ requestId }).error("configuration_invalid", describeError(error));
      const isApi = url.pathname.startsWith("/api/");
      const body = isApi
        ? JSON.stringify({
            error: {
              code: "service_unavailable",
              message: "Service temporarily unavailable.",
              requestId,
            },
          })
        : unavailablePage(requestId);
      return new Response(body, {
        status: 503,
        headers: {
          "Content-Type": isApi ? "application/json" : "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      });
    }

    const server = c.get("server");
    try {
      await next();
    } catch (error) {
      // Normally unreachable (app.onError handles thrown errors); kept as the last resort.
      c.res = failureResponse(c, error);
    }

    const contentType = c.res.headers.get("content-type") ?? "";
    c.res = applySecurityHeaders(c.res, {
      nonce: c.get("nonce"),
      isHtml: contentType.includes("text/html"),
      pathname: url.pathname,
      productionLike: server.config.isProductionLike,
      devServer: options.devServer ?? false,
      requestId,
    });
    const maintenance = c.get("maintenance") === true;
    server.log[requestLogLevel(c.res.status, maintenance)]("request", {
      status: c.res.status,
      durationMs: Date.now() - started,
      ...(maintenance ? { maintenance: true } : {}),
    });
  });

  // 2. CSRF gate for state-changing requests (webhooks authenticate by signature instead).
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (
      UNSAFE_METHODS.has(c.req.method) &&
      !path.startsWith("/api/webhooks/") &&
      !isSameOriginRequest(c.req.raw)
    ) {
      await recordSecurityEvent(c.get("server"), {
        type: "csrf.rejected",
        severity: "low",
        details: {
          path,
          origin: c.req.header("origin") ?? null,
          site: c.req.header("sec-fetch-site") ?? null,
        },
      });
      if (path.startsWith("/api/")) return apiError(c, new AppError("csrf_rejected"));
      return c.html(
        "<!doctype html><title>Request blocked</title><p>This request was blocked for your security. Go back, refresh the page and try again.</p>",
        403,
      );
    }
    await next();
  });

  // 3. Session resolution (only when a session cookie is present).
  app.use("*", async (c, next) => {
    const server = c.get("server");
    if (c.req.header("cookie")) {
      const resolved = await resolveSession(server, c.req.raw);
      if (resolved.kind === "full") c.set("actor", resolved.actor);
      if (resolved.kind === "pending") c.set("pending", resolved.pending);
    }
    await next();
  });

  // 4. Maintenance gate (staff with maintenance.manage or admin.access keep working).
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (isMaintenanceExempt(path)) return next();
    const state = await getMaintenanceState(c.get("server"));
    if (!state.enabled) return next();
    const actor = c.get("actor");
    if (
      actor &&
      (actor.permissions.has("maintenance.manage") || actor.permissions.has("admin.access"))
    )
      return next();
    c.set("maintenance", true);
    if (path.startsWith("/api/")) {
      const res = apiError(c, new AppError("maintenance"));
      res.headers.set("Retry-After", "600");
      return res;
    }
    return c.html(maintenancePage(state.message), 503, {
      "Retry-After": "600",
      "Cache-Control": "no-store",
    });
  });

  // 5. Legacy Mark4 URLs → their new homes (permanent, preserves search equity).
  app.get("*", async (c, next) => {
    const target = LEGACY_REDIRECTS[new URL(c.req.url).pathname];
    if (target) return c.redirect(target, 301);
    await next();
  });

  // 6. JSON API. Unmatched /api paths get the JSON 404 envelope — never the HTML page renderer.
  app.route("/api", createApi());
  app.all("/api/*", (c) => apiError(c, errors.notFound()));

  // 7. Everything else renders through React Router with the same request context.
  app.all("*", async (c) => {
    const context = new RouterContextProvider();
    context.set(appContext, {
      server: c.get("server"),
      actor: c.get("actor"),
      pending: c.get("pending"),
      cspNonce: c.get("nonce"),
    });
    return options.renderPage(c.req.raw, context);
  });

  // Anything thrown by a middleware or handler: log it with the request ID and answer with a
  // generic response (JSON envelope for the API, the kernel error page otherwise). Hono's default
  // handler would return plain text and lose the error details.
  app.onError((error, c) => failureResponse(c, error));

  return app;
}

function failureResponse(c: Context<KernelEnv>, error: unknown): Response {
  const server = c.get("server");
  const requestId = server?.requestId ?? "unknown";
  if (new URL(c.req.url).pathname.startsWith("/api/")) return apiError(c, error);
  (server?.log ?? createLogger({ requestId })).error("unhandled_error", describeError(error));
  return new Response(unavailablePage(requestId), {
    status: 500,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
