/**
 * Structured JSON logging (one line per entry on Railway). Every line carries the request ID. Values under
 * sensitive keys are redacted recursively, so a careless `log.info("x", { body })` cannot leak a
 * password, token, code or cookie.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|set-cookie|api[-_]?key|otp|code|recovery|session|signature|credential|private|cv|message_body|body_html/i;
// Keys that match the pattern above but are known to be safe identifiers/diagnostics.
const SAFE_KEYS = new Set(["requestId", "errorCode", "statusCode", "status", "sessionCount"]);

/**
 * CP-2.1 · O-2: value-pattern scrubbing for free text (error messages, stack traces, provider
 * errors). Key-based redaction above cannot see a credential that is part of a sentence, e.g.
 * "D1 password=hunter2". Each pattern keeps its label so the line stays useful. Deliberately
 * narrow: it targets credentials, not ordinary identifiers.
 */
const SECRET_VALUE_PATTERNS: readonly [RegExp, string][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    "[redacted:private-key]",
  ],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted:jwt]"],
  [/\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}/g, "[redacted:resend-key]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted:google-key]"],
  [/\b0x4AAAAAAA[A-Za-z0-9_-]{20,}/g, "[redacted:turnstile-secret]"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, "[redacted:github-token]"],
  [/\b(?:__Host-)?vora_session=[^;\s,"']+/g, "vora_session=[redacted]"],
  // "password=…", "secret: …" — any value.
  [/\b(pass(?:word|wd)?|pwd|secret)("?\s*[=:]\s*)("?)[^\s"'&;,]+/gi, "$1$2$3[redacted]"],
  // "token=…", "api_key: …" — only credential-like values (contain a digit), so wording such as
  // "setup token: mismatch" stays readable.
  [
    /\b(token|api[-_]?key|apikey|authorization)("?\s*[=:]\s*)("?)(?=[^\s"'&;,]*\d)[^\s"'&;,]{6,}/gi,
    "$1$2$3[redacted]",
  ],
  // One-time sign-in codes written into text.
  [/\b(otp|(?:sign-?in|verification|security) code)(\s*[=:]?\s*)\d{4,8}\b/gi, "$1$2[redacted]"],
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS)
    out = out.replace(pattern, replacement);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value === null || typeof value !== "object") {
    if (typeof value !== "string") return value;
    const capped = value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    return scrubSecrets(capped);
  }
  if (value instanceof Error) {
    return { name: value.name, message: scrubSecrets(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!SAFE_KEYS.has(key) && SENSITIVE_KEY.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = redact(v, depth + 1);
    }
  }
  return out;
}

/** One redacted log entry, as handed to the sink. */
export type LogLine = { level: LogLevel; msg: string; time: string } & Record<string, unknown>;
export type LogSink = (line: LogLine) => void;

/** Default sink: the structured object to the console (what the tests observe). */
const consoleSink: LogSink = (line) => {
  if (line.level === "error") console.error(line);
  else if (line.level === "warn") console.warn(line);
  else console.log(line);
};

/**
 * Railway parses single-line JSON with `message` and `level` (migration §4.6). This sink writes
 * exactly one line per entry — stderr for warnings and errors, stdout otherwise. The entry is
 * already redacted; `message` repeats the event name so Railway shows it, and it is placed last
 * so a data field cannot overwrite it.
 */
export function jsonLineSink(
  write: (stream: "stdout" | "stderr", text: string) => void = (stream, text) =>
    process[stream].write(text),
): LogSink {
  return (line) => {
    let text: string;
    try {
      text = JSON.stringify({ ...line, message: line.msg });
    } catch {
      // Unserialisable data (e.g. a BigInt or a cycle) must not lose the entry.
      text = JSON.stringify({
        level: line.level,
        msg: line.msg,
        message: line.msg,
        time: line.time,
      });
    }
    write(line.level === "error" || line.level === "warn" ? "stderr" : "stdout", `${text}\n`);
  };
}

let sink: LogSink = consoleSink;

/** The Node server installs `jsonLineSink()` at start-up; tests keep the console sink. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? consoleSink;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  bindings: Record<string, unknown> = {},
  minLevel: LogLevel = "info",
): Logger {
  const emit = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const line: LogLine = {
      level,
      msg,
      time: new Date().toISOString(),
      ...(redact(bindings) as Record<string, unknown>),
      ...(data ? (redact(data) as Record<string, unknown>) : {}),
    };
    sink(line);
  };
  return {
    debug: (msg, data) => emit("debug", msg, data),
    info: (msg, data) => emit("info", msg, data),
    warn: (msg, data) => emit("warn", msg, data),
    error: (msg, data) => emit("error", msg, data),
    child: (extra) => createLogger({ ...bindings, ...extra }, minLevel),
  };
}

/** Serialises an unknown error for logs without leaking provider payloads. */
export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const out: Record<string, unknown> = { errorName: error.name, errorMessage: error.message };
    const maybe = error as Error & { code?: unknown; internal?: unknown };
    if (typeof maybe.code === "string") out.errorCode = maybe.code;
    if (maybe.internal && typeof maybe.internal === "object") out.internal = maybe.internal;
    if (error.stack) out.stack = error.stack.split("\n").slice(0, 8).join("\n");
    return out;
  }
  return { errorMessage: String(error) };
}
