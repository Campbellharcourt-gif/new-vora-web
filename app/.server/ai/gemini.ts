import { AiError, type AiHealth, type AiProvider, type AiRequest, type AiResult } from "./types";

/**
 * Gemini adapter (REST, server-side only). The API key is sent in the `x-goog-api-key` header
 * and never leaves the Worker. Optionally routed through Cloudflare AI Gateway via `baseUrl`.
 *
 * Notes (Sep 2026): `temperature`/`topP`/`topK` are deprecated for current models and
 * `thinkingConfig.thinkingLevel` replaces thinking budgets, so neither is sent.
 */
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

const MODEL_PATTERN = /^[a-z0-9.-]{3,64}$/;

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = GEMINI_DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(model: string, method: string): string {
    if (!MODEL_PATTERN.test(model)) throw new AiError("config", "Invalid model name");
    return `${this.baseUrl.replace(/\/+$/, "")}/v1beta/models/${model}${method}`;
  }

  private body(request: AiRequest): string {
    return JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        thinkingConfig: { thinkingLevel: request.thinkingLevel },
      },
    });
  }

  private async post(url: string, request: AiRequest): Promise<Response> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: this.body(request),
        signal: controller.signal,
      });
      if (!res.ok) throw mapHttpError(res.status);
      return res;
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (controller.signal.aborted)
        throw new AiError("timeout", "Gemini request timed out", { cause: error });
      throw new AiError("unavailable", "Gemini request failed", { cause: error });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }

  async generate(request: AiRequest): Promise<AiResult> {
    const res = await this.post(this.url(request.model, ":generateContent"), request);
    let data: unknown;
    try {
      data = await res.json();
    } catch (error) {
      throw new AiError("malformed", "Gemini returned invalid JSON", { cause: error });
    }
    return parseGenerateResponse(data, request.model);
  }

  async *stream(request: AiRequest): AsyncIterable<string> {
    const res = await this.post(this.url(request.model, ":streamGenerateContent?alt=sse"), request);
    if (!res.body) throw new AiError("malformed", "Gemini stream had no body");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let produced = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const event = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const text of parseSseEvent(event)) {
            produced = true;
            yield text;
          }
          index = buffer.indexOf("\n\n");
        }
      }
      for (const text of parseSseEvent(buffer)) {
        produced = true;
        yield text;
      }
    } finally {
      reader.releaseLock();
    }
    if (!produced) throw new AiError("malformed", "Gemini stream ended without content");
  }

  async health(model: string, timeoutMs = 3000): Promise<AiHealth> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(this.url(model, ""), {
        headers: { "x-goog-api-key": this.apiKey },
        signal: controller.signal,
      });
      if (!res.ok)
        return {
          ok: false,
          latencyMs: Date.now() - started,
          detail: mapHttpError(res.status).kind,
        };
      return { ok: true, latencyMs: Date.now() - started };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: controller.signal.aborted ? "timeout" : "unavailable",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function mapHttpError(status: number): AiError {
  if (status === 429) return new AiError("rate_limited", "Gemini rate limit", { status });
  if (status === 401 || status === 403)
    return new AiError("config", "Gemini rejected the API key", { status });
  if (status === 404) return new AiError("config", "Gemini model not found", { status });
  if (status === 400) return new AiError("bad_request", "Gemini rejected the request", { status });
  if (status >= 500) return new AiError("unavailable", "Gemini server error", { status });
  return new AiError("unavailable", `Gemini HTTP ${status}`, { status });
}

/** Validates the response shape strictly; anything unexpected is a `malformed` error. */
export function parseGenerateResponse(data: unknown, model: string): AiResult {
  if (!data || typeof data !== "object")
    throw new AiError("malformed", "Gemini response was not an object");
  const response = data as GeminiResponse;
  if (response.promptFeedback?.blockReason) {
    throw new AiError("blocked", `Prompt blocked: ${response.promptFeedback.blockReason}`);
  }
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] : undefined;
  if (!candidate) throw new AiError("malformed", "Gemini response had no candidates");
  if (candidate.finishReason === "SAFETY" || candidate.finishReason === "PROHIBITED_CONTENT") {
    throw new AiError("blocked", `Response blocked: ${candidate.finishReason}`);
  }
  const parts = candidate.content?.parts;
  if (!Array.isArray(parts)) throw new AiError("malformed", "Gemini candidate had no parts");
  const text = parts
    .filter((p) => typeof p?.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("")
    .trim();
  if (!text) throw new AiError("malformed", "Gemini returned empty text");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    text,
    inputTokens: num(response.usageMetadata?.promptTokenCount),
    outputTokens: num(response.usageMetadata?.candidatesTokenCount),
    finishReason: candidate.finishReason ?? null,
    model: typeof response.modelVersion === "string" ? response.modelVersion : model,
  };
}

/** Extracts text chunks from one SSE event block (`data: {...}` lines). */
export function parseSseEvent(event: string): string[] {
  const out: string[] = [];
  for (const line of event.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let data: GeminiResponse;
    try {
      data = JSON.parse(payload) as GeminiResponse;
    } catch {
      throw new AiError("malformed", "Gemini stream chunk was not JSON");
    }
    if (data.promptFeedback?.blockReason) throw new AiError("blocked", "Prompt blocked");
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (typeof part.text === "string" && part.text && !part.thought) out.push(part.text);
    }
  }
  return out;
}
