import type { Context } from "hono";
import type { KernelEnv } from "../kernel/types";
import { AppError, isAppError, toErrorEnvelope } from "../lib/errors";
import { describeError } from "../observability/logger";

/** Consistent JSON error responses for every API route. Never includes stack traces or internals. */
export function apiError(c: Context<KernelEnv>, error: unknown): Response {
  const server = c.get("server");
  const app = isAppError(error) ? error : new AppError("internal_error");
  if (isAppError(error) && app.code === "maintenance") {
    // Planned maintenance is expected behaviour, not a fault (CP-2.1 · O-1).
    server?.log.info("api_maintenance", { code: app.code, status: app.status, maintenance: true });
  } else if (!isAppError(error) || app.status >= 500) {
    server?.log.error("api_error", { code: app.code, ...describeError(error) });
  } else {
    server?.log.info("api_client_error", { code: app.code, status: app.status });
  }
  const res = c.json(toErrorEnvelope(app, server?.requestId), app.status as 400);
  if (app.retryAfterSeconds) res.headers.set("Retry-After", String(app.retryAfterSeconds));
  return res;
}

/** Parses a JSON body with a hard size cap; malformed or oversized bodies become 400/413. */
export async function readJson(c: Context<KernelEnv>, maxBytes = 64 * 1024): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new AppError("unsupported_media_type", { message: "Send JSON (application/json)." });
  }
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > maxBytes) throw new AppError("payload_too_large");
  const text = await c.req.text();
  if (text.length > maxBytes) throw new AppError("payload_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("bad_request", { message: "The request body is not valid JSON." });
  }
}
