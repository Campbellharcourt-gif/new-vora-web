import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractSources, publicAssistantAvailability } from "~/.server/ai/assistant";
import { setAiProviderOverride } from "~/.server/ai/service";
import {
  AI_USER_MESSAGES,
  type AiHealth,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from "~/.server/ai/types";
import { SETTINGS } from "~/.server/services/settings";
import {
  call,
  makeCtx,
  putSetting,
  resetCaches,
  SAME_ORIGIN,
  setFlag,
  uniqueIp,
} from "../support/helpers";

/**
 * The public "Ask VORA" assistant (design system §11.5, D8): off unless the flag, the setting
 * AND a server-side key are present; answers come only from the server; sources are limited to
 * published paths; failures are reported, never filled in.
 */

class FakeProvider implements AiProvider {
  readonly name = "fake";
  requests: AiRequest[] = [];
  constructor(private readonly text: string) {}
  async generate(request: AiRequest): Promise<AiResult> {
    this.requests.push(request);
    return { text: this.text, inputTokens: 10, outputTokens: 5, finishReason: "STOP", model: "m" };
  }
  async *stream(): AsyncIterable<string> {
    yield "unused";
  }
  async health(): Promise<AiHealth> {
    return { ok: true, latencyMs: 1 };
  }
}

async function switchOn() {
  await putSetting("ai.config", { ...SETTINGS["ai.config"].default, publicEnabled: true });
  await setFlag("ai.public_assistant", true);
}

async function switchOff() {
  await putSetting("ai.config", SETTINGS["ai.config"].default);
  await setFlag("ai.public_assistant", false);
}

function ask(content = "Who delivers branding?", headers: Record<string, string> = SAME_ORIGIN) {
  return call("/api/v1/ai/ask", {
    method: "POST",
    ip: uniqueIp(),
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
}

beforeEach(async () => {
  resetCaches();
  setAiProviderOverride(null);
  await switchOff();
});
afterEach(() => setAiProviderOverride(null));

describe("Ask VORA — availability", () => {
  it("is unavailable by default, and the API refuses without calling a provider", async () => {
    const provider = new FakeProvider("should never be used");
    setAiProviderOverride(provider);
    expect((await publicAssistantAvailability(makeCtx(), null)).available).toBe(false);
    const res = await ask();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(AI_USER_MESSAGES.disabled);
    expect(provider.requests).toHaveLength(0);
  });

  it("stays unavailable with the flag and setting on but no server-side key", async () => {
    await switchOn();
    expect((await publicAssistantAvailability(makeCtx(), null)).available).toBe(false);
    const res = await ask();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(AI_USER_MESSAGES.config);
  });

  it("is available only when the flag, the setting and a provider are all present", async () => {
    await switchOn();
    setAiProviderOverride(new FakeProvider("ok"));
    const availability = await publicAssistantAvailability(makeCtx(), null);
    expect(availability).toEqual({
      available: true,
      maxInputChars: SETTINGS["ai.config"].default.maxInputChars,
    });
  });
});

describe("Ask VORA — answers", () => {
  it("returns the provider's answer with only allow-listed published sources", async () => {
    await switchOn();
    const provider = new FakeProvider(
      "Branding is delivered with Solara Studios.\nSOURCES: /contact, https://evil.example, /admin, /contact",
    );
    setAiProviderOverride(provider);
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { text: string; sources: { href: string }[] };
    expect(body.text).toBe("Branding is delivered with Solara Studios.");
    expect(body.sources).toEqual([{ href: "/contact", label: "Contact" }]);
    // Grounded in published pages; the key and drafts never enter the prompt.
    const system = provider.requests[0]?.system ?? "";
    expect(system).toContain("PAGE /contact");
    expect(system).toMatch(/Answer ONLY from the published pages/);
  });

  it("reports an empty answer as a failure instead of inventing one", async () => {
    await switchOn();
    setAiProviderOverride(new FakeProvider("SOURCES: /contact"));
    const res = await ask();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(AI_USER_MESSAGES.malformed);
  });

  it("validates the request and refuses cross-site posts", async () => {
    await switchOn();
    setAiProviderOverride(new FakeProvider("ok"));
    const empty = await call("/api/v1/ai/ask", {
      method: "POST",
      headers: { ...SAME_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(empty.status).toBe(422);
    const crossSite = await ask("hi", {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    });
    expect(crossSite.status).toBe(403);
  });
});

describe("extractSources", () => {
  const allowed = new Map([
    ["/services", "Services"],
    ["/partners", "Partners"],
  ]);
  it("strips the SOURCES line and keeps known paths once, in order", () => {
    expect(
      extractSources("Answer.\nSOURCES: /partners, /services., /nope, /partners", allowed),
    ).toEqual({
      text: "Answer.",
      sources: [
        { href: "/partners", label: "Partners" },
        { href: "/services", label: "Services" },
      ],
    });
  });
  it("leaves an answer without a SOURCES line untouched", () => {
    expect(extractSources("Just an answer.", allowed)).toEqual({
      text: "Just an answer.",
      sources: [],
    });
  });
});
