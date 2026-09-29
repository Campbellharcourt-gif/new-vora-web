import type { FieldErrors } from "@shared/validation/common";

/**
 * Application errors. `code` is a stable machine-readable identifier; `publicMessage` is safe to
 * show to users. Internal detail (`cause`, `internal`) is logged, never returned to clients.
 */
export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "mfa_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payload_too_large"
  | "unsupported_media_type"
  | "csrf_rejected"
  | "maintenance"
  | "service_unavailable"
  | "provider_error"
  | "configuration_error"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  mfa_required: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  csrf_rejected: 403,
  maintenance: 503,
  service_unavailable: 503,
  provider_error: 502,
  configuration_error: 500,
  internal_error: 500,
};

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  bad_request: "The request could not be processed.",
  validation_failed: "Some details need attention.",
  unauthenticated: "Please sign in to continue.",
  mfa_required: "Please complete two-step verification.",
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find what you were looking for.",
  conflict: "That change conflicts with the current state. Refresh and try again.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  payload_too_large: "That upload is too large.",
  unsupported_media_type: "That file type isn't supported.",
  csrf_rejected: "This request was blocked for your security. Refresh the page and try again.",
  maintenance: "VORA is undergoing scheduled maintenance. Please check back shortly.",
  service_unavailable: "This service is temporarily unavailable. Please try again shortly.",
  provider_error: "An external service didn't respond as expected. Please try again.",
  configuration_error: "Something went wrong on our side.",
  internal_error: "Something went wrong on our side.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly fields?: FieldErrors;
  readonly retryAfterSeconds?: number;
  /** Extra context for logs only. Must not contain secrets. */
  readonly internal?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fields?: FieldErrors;
      retryAfterSeconds?: number;
      internal?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? DEFAULT_MESSAGES[code], { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = options.message ?? DEFAULT_MESSAGES[code];
    if (options.fields) this.fields = options.fields;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.internal) this.internal = options.internal;
  }
}

export const errors = {
  validation: (fields: FieldErrors, message?: string) =>
    new AppError("validation_failed", { fields, ...(message ? { message } : {}) }),
  unauthenticated: () => new AppError("unauthenticated"),
  forbidden: (internal?: Record<string, unknown>) =>
    new AppError("forbidden", internal ? { internal } : {}),
  notFound: (message?: string) => new AppError("not_found", message ? { message } : {}),
  conflict: (message?: string) => new AppError("conflict", message ? { message } : {}),
  rateLimited: (retryAfterSeconds = 60) => new AppError("rate_limited", { retryAfterSeconds }),
  unavailable: (message?: string) =>
    new AppError("service_unavailable", message ? { message } : {}),
  config: (internal: Record<string, unknown>) => new AppError("configuration_error", { internal }),
};

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    fields?: FieldErrors;
    requestId?: string;
  };
}

/** Converts any thrown value into a safe public envelope (unknown errors become internal_error). */
export function toErrorEnvelope(error: unknown, requestId?: string): ErrorEnvelope {
  const app = isAppError(error) ? error : new AppError("internal_error");
  return {
    error: {
      code: app.code,
      message: app.publicMessage,
      ...(app.fields ? { fields: app.fields } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
}

export function statusOf(error: unknown): number {
  return isAppError(error) ? error.status : 500;
}
