/**
 * Provider-independent AI contract. Domain code talks only to this interface; swapping Gemini
 * for another provider means adding one adapter, not touching routes, services or the UI.
 */
export type ThinkingLevel = "low" | "medium" | "high";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiRequest {
  model: string;
  system: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  thinkingLevel: ThinkingLevel;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AiResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  model: string;
}

export interface AiHealth {
  ok: boolean;
  latencyMs: number;
  detail?: AiErrorKind;
}

export type AiErrorKind =
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "blocked"
  | "malformed"
  | "config"
  | "bad_request";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    kind: AiErrorKind,
    message: string,
    options: { status?: number | null; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryable = kind === "timeout" || kind === "unavailable" || kind === "rate_limited";
  }
}

export interface AiProvider {
  readonly name: string;
  generate(request: AiRequest): Promise<AiResult>;
  stream(request: AiRequest): AsyncIterable<string>;
  health(model: string, timeoutMs?: number): Promise<AiHealth>;
}

/** Friendly, non-revealing messages for each failure kind (never provider text). */
export const AI_USER_MESSAGES: Record<AiErrorKind | "disabled" | "quota", string> = {
  timeout: "VORA AI took too long to respond. Please try again.",
  rate_limited: "VORA AI is busy right now. Please try again in a minute.",
  unavailable:
    "VORA AI is temporarily unavailable. You can still reach the team through the contact page.",
  blocked: "VORA AI can't help with that request.",
  malformed: "VORA AI returned an unexpected response. Please try again.",
  config:
    "VORA AI is temporarily unavailable. You can still reach the team through the contact page.",
  bad_request: "VORA AI couldn't process that message. Try rephrasing it.",
  disabled: "VORA AI is not available right now.",
  quota: "VORA AI has reached its limit for today. Please reach the team through the contact page.",
};
