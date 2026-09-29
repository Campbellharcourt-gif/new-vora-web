import { describe, expect, it, vi } from "vitest";
import {
  GeminiProvider,
  mapHttpError,
  parseGenerateResponse,
  parseSseEvent,
} from "~/.server/ai/gemini";
import { AiError, type AiRequest } from "~/.server/ai/types";

const request: AiRequest = {
  model: "gemini-3.8-flash",
  system: "You are VORA AI.",
  messages: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi — how can I help?" },
    { role: "user", content: "What does VORA do?" },
  ],
  maxOutputTokens: 256,
  thinkingLevel: "low",
  timeoutMs: 2000,
};

const ok = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

describe("Gemini response parsing", () => {
  it("joins text parts, drops thought parts and reads token usage", () => {
    const result = parseGenerateResponse(
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "internal", thought: true },
                { text: "VORA builds " },
                { text: "websites." },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
        modelVersion: "gemini-3.8-flash-001",
      },
      "gemini-3.8-flash",
    );
    expect(result).toEqual({
      text: "VORA builds websites.",
      inputTokens: 12,
      outputTokens: 5,
      finishReason: "STOP",
      model: "gemini-3.8-flash-001",
    });
  });

  it("classifies blocked prompts and blocked responses", () => {
    const blocked = () => parseGenerateResponse({ promptFeedback: { blockReason: "SAFETY" } }, "m");
    expect(blocked).toThrow(AiError);
    expect(() => blocked()).toThrowError(expect.objectContaining({ kind: "blocked" }));
    expect(() =>
      parseGenerateResponse(
        { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] },
        "m",
      ),
    ).toThrowError(expect.objectContaining({ kind: "blocked" }));
  });

  it("treats every unexpected shape as malformed", () => {
    for (const data of [
      null,
      "text",
      {},
      { candidates: [] },
      { candidates: [{}] },
      { candidates: [{ content: { parts: [] } }] },
      { candidates: [{ content: { parts: [{ text: "   " }] } }] },
      { candidates: [{ content: { parts: [{ thought: true, text: "only thoughts" }] } }] },
    ]) {
      expect(() => parseGenerateResponse(data, "m"), JSON.stringify(data)).toThrowError(
        expect.objectContaining({ kind: "malformed" }),
      );
    }
  });

  it("maps HTTP statuses to retry-aware error kinds", () => {
    expect(mapHttpError(429)).toMatchObject({ kind: "rate_limited", retryable: true });
    expect(mapHttpError(401)).toMatchObject({ kind: "config", retryable: false });
    expect(mapHttpError(403)).toMatchObject({ kind: "config" });
    expect(mapHttpError(404)).toMatchObject({ kind: "config" });
    expect(mapHttpError(400)).toMatchObject({ kind: "bad_request", retryable: false });
    expect(mapHttpError(503)).toMatchObject({ kind: "unavailable", retryable: true });
  });

  it("parses SSE events and rejects corrupt chunks", () => {
    const event = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"x","thought":true},{"text":"lo"}]}}]}',
      "data: [DONE]",
      ": comment",
    ].join("\n");
    expect(parseSseEvent(event)).toEqual(["Hel", "lo"]);
    expect(() => parseSseEvent("data: {not json")).toThrowError(
      expect.objectContaining({ kind: "malformed" }),
    );
  });
});

describe("GeminiProvider (fake fetch)", () => {
  it("keeps the key in a header, maps roles and sends thinking config", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      ok({ candidates: [{ content: { parts: [{ text: "Answer" }] }, finishReason: "STOP" }] }),
    );
    const provider = new GeminiProvider(
      "SECRET-KEY",
      "https://gateway.example/v1/g/",
      fetchImpl as never,
    );
    const result = await provider.generate(request);
    expect(result.text).toBe("Answer");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://gateway.example/v1/g/v1beta/models/gemini-3.8-flash:generateContent");
    expect(url).not.toContain("SECRET-KEY");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("SECRET-KEY");
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toBe("You are VORA AI.");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 256,
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(JSON.stringify(body)).not.toContain("temperature");
  });

  it("refuses unsafe model names before any request", async () => {
    const fetchImpl = vi.fn();
    const provider = new GeminiProvider("k", undefined, fetchImpl as never);
    await expect(
      provider.generate({ ...request, model: "../../v1/secrets" }),
    ).rejects.toMatchObject({
      kind: "config",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider HTTP errors, invalid JSON and network failures", async () => {
    const provider = (impl: () => Promise<Response>) =>
      new GeminiProvider("k", undefined, impl as never);
    await expect(
      provider(async () => new Response("{}", { status: 429 })).generate(request),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(
      provider(async () => new Response("<html>", { status: 200 })).generate(request),
    ).rejects.toMatchObject({ kind: "malformed" });
    await expect(
      provider(async () => {
        throw new TypeError("fetch failed");
      }).generate(request),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("times out slow requests", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const provider = new GeminiProvider("k", undefined, hang as never);
    const started = Date.now();
    await expect(provider.generate({ ...request, timeoutMs: 50 })).rejects.toMatchObject({
      kind: "timeout",
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("streams text across chunk boundaries", async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"VO"}]}}]}\n',
      '\ndata: {"candidates":[{"content":{"parts":[{"text":"RA"}]}}]}\n\ndata: {"candid',
      'ates":[{"content":{"parts":[{"text":"!"}]}}]}\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    const provider = new GeminiProvider("k", undefined, (async () => new Response(body)) as never);
    const out: string[] = [];
    for await (const text of provider.stream(request)) out.push(text);
    expect(out.join("")).toBe("VORA!");
  });

  it("fails an empty stream as malformed", async () => {
    const provider = new GeminiProvider(
      "k",
      undefined,
      (async () => new Response("data: [DONE]\n\n")) as never,
    );
    const consume = async () => {
      for await (const _ of provider.stream(request)) {
        // drain
      }
    };
    await expect(consume()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("reports health without throwing", async () => {
    const healthy = new GeminiProvider("k", undefined, (async () =>
      ok({ name: "models/x" })) as never);
    expect(await healthy.health("gemini-3.8-flash")).toMatchObject({ ok: true });
    const denied = new GeminiProvider(
      "k",
      undefined,
      (async () => new Response("", { status: 403 })) as never,
    );
    expect(await denied.health("gemini-3.8-flash")).toMatchObject({ ok: false, detail: "config" });
    const down = new GeminiProvider("k", undefined, (async () => {
      throw new Error("down");
    }) as never);
    expect(await down.health("gemini-3.8-flash")).toMatchObject({
      ok: false,
      detail: "unavailable",
    });
  });
});
