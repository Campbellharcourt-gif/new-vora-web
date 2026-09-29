import type { Permission } from "@shared/permissions";
import { data, type RouterContextProvider, redirect } from "react-router";
import type { Actor } from "./auth/types";
import { type AppLoadContext, appContext } from "./context";
import { isAppError } from "./lib/errors";
import { recordSecurityEvent } from "./observability/security-events";

/** Reads the per-request context set by the kernel. */
export function load(context: Readonly<RouterContextProvider>): AppLoadContext {
  return context.get(appContext);
}

/** Only same-site relative paths are accepted as post-login destinations (no open redirects). */
export function safeNext(value: string | null | undefined, fallback = "/account"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}

function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;
  return redirect(`/login?next=${encodeURIComponent(next)}`);
}

/** Requires a fully signed-in user; otherwise redirects to sign-in (preserving the destination). */
export function requireActor(context: Readonly<RouterContextProvider>, request: Request): Actor {
  const { actor } = load(context);
  if (!actor) throw loginRedirect(request);
  return actor;
}

/**
 * Requires a permission. Anonymous → sign-in; signed in without the permission → 403 page.
 * This guards navigation; services re-check every operation independently.
 */
export async function requirePermission(
  context: Readonly<RouterContextProvider>,
  request: Request,
  permission: Permission,
): Promise<Actor> {
  const actor = requireActor(context, request);
  if (!actor.permissions.has(permission)) {
    await recordSecurityEvent(load(context).server, {
      type: "authz.denied",
      severity: "low",
      userId: actor.userId,
      details: { permission, path: new URL(request.url).pathname },
    });
    throw data({ message: "You don't have access to this area." }, { status: 403 });
  }
  return actor;
}

export function redirectIfSignedIn(
  context: Readonly<RouterContextProvider>,
  to = "/account",
): void {
  if (load(context).actor) throw redirect(to);
}

export interface ActionFailure {
  status: number;
  message: string;
  fields: Record<string, string>;
}

/**
 * Converts a service error into something a form can display. Access errors (401/403/404) are
 * re-thrown as error responses for the route's error boundary; unknown errors are re-thrown so
 * they are logged and shown as a generic 500 — never leaked into the page.
 */
export function failureFrom(error: unknown): ActionFailure {
  if (isAppError(error)) {
    if (
      error.code === "forbidden" ||
      error.code === "not_found" ||
      error.code === "unauthenticated"
    ) {
      throw data({ message: error.publicMessage }, { status: error.status });
    }
    return { status: error.status, message: error.publicMessage, fields: error.fields ?? {} };
  }
  throw error;
}

/** Maps a service error into route action data with field errors (or rethrows unexpected errors). */
export function actionError(error: unknown) {
  const failure = failureFrom(error);
  return data(
    { ok: false as const, message: failure.message, fields: failure.fields },
    { status: failure.status },
  );
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
