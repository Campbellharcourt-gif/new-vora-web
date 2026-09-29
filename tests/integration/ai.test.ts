import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiHealth, clearAiHealthCache, runAi, setAiProviderOverride } from "~/.server/ai/service";
import {
  AI_USER_MESSAGES,
  AiError,
  type AiHealth,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from "~/.server/ai/types";
import { AppError } from "~/.server/lib/errors";
import { SETTINGS, type SettingValue } from "~/.server/services/settings";
import {
  actorFor,
  createUser,
  db,
  makeCtx,
  putSetting,
  resetCaches,
  schema,
  setFlag,
  uniqueIp,
} from "../support/helpers";

class FakeProvider implements AiProvider {
  readonly name = "fake";
  requests: AiRequest[] = [];
  healthChecks = 0;
  constructor(private readonly impl: (request: AiRequest) => Promise<AiResult>) {}
  generate(request: AiRequest): Promise<AiResult> {
    this.requests.push(request);
    return this.impl(request);
  }
  async *stream(): AsyncIterable<string> {
    yield "unused";
  }
  async health(): Promise<AiHealth> {
    this.healthChecks += 1;
    return { ok: true, latencyMs: 5 };
  }
}

const answer = (text = "VORA designs and builds websites.") =>
  new FakeProvider(async (req) => ({
    text,
    inputTokens: 1000,
    outputTokens: 200,
    finishReason: "STOP",
    model: req.model,
  }));
const failing = (kind: AiError["kind"]) =>
  new FakeProvider(async () => {
    throw new AiError(kind, `provider said: internal detail for ${kind}`);
  });

const DEFAULT_CONFIG = SETTINGS["ai.config"].default;
const ask = (content = "What does VORA do?") => [{ role: "user" as const, content }];

async function enableAi(overrides: Partial<SettingValue<"ai.config">> = {}) {
  await putSetting("ai.config", {
    ...DEFAULT_CONFIG,
    publicEnabled: true,
    adminEnabled: true,
    priceInputPerMTokUsd: 0.3,
    priceOutputPerMTokUsd: 2.5,
    ...overrides,
  });
  await setFlag("ai.public_assistant", true);
  await setFlag("ai.admin_tools", true);
}

async function publicAsk(provider?: FakeProvider) {
  if (provider) setAiProviderOverride(provider);
  return runAi(makeCtx({ ip: uniqueIp() }), {
    channel: "public",
    actor: null,
    system: "You are VORA AI.",
    messages: ask(),
  });
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

beforeEach(() => {
  resetCaches();
  clearAiHealthCache();
  setAiProviderOverride(null);
});
afterEach(() => setAiProviderOverride(null));

describe("VORA AI guard rails", () => {
  it("is off by default and never calls a provider while off", async () => {
    const provider = answer();
    const error = await appError(publicAsk(provider));
    expect(error.code).toBe("service_unavailable");
    expect(error.publicMessage).toBe(AI_USER_MESSAGES.disabled);
    expect(provider.requests).toHaveLength(0);
  });

  it("answers through the provider and records usage and estimated cost", async () => {
    await enableAi();
    const provider = answer();
    expect(await publicAsk(provider)).toEqual({ text: "VORA designs and builds websites." });
    expect(provider.requests[0]).toMatchObject({
      model: "gemini-3.8-flash",
      system: "You are VORA AI.",
      maxOutputTokens: 1024,
      thinkingLevel: "low",
    });
    const usage = await db.select().from(schema.aiUsage).all();
    expect(usage.at(-1)).toMatchObject({
      channel: "public",
      status: "ok",
      inputTokens: 1000,
      outputTokens: 200,
      costMicroUsd: 1000 * 0.3 + 200 * 2.5,
    });
  });

  it("fails safely when no provider key is configured", async () => {
    await enableAi();
    const error = await appError(publicAsk());
    expect(error.publicMessage).toBe(AI_USER_MESSAGES.config);
  });

  it("retries a transient failure once, then returns a friendly message (no provider text)", async () => {
    await enableAi();
    const provider = failing("unavailable");
    const error = await appError(publicAsk(provider));
    expect(provider.requests).toHaveLength(2);
    expect(error.publicMessage).toBe(AI_USER_MESSAGES.unavailable);
    expect(error.publicMessage).not.toContain("internal detail");
  });

  it("does not retry timeouts or blocked prompts; blocked public prompts are logged", async () => {
    await enableAi();
    const slow = failing("timeout");
    expect((await appError(publicAsk(slow))).publicMessage).toBe(AI_USER_MESSAGES.timeout);
    expect(slow.requests).toHaveLength(1);
    const blocked = failing("blocked");
    expect((await appError(publicAsk(blocked))).publicMessage).toBe(AI_USER_MESSAGES.blocked);
    expect(blocked.requests).toHaveLength(1);
    const abuse = await db
      .select()
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.type, "ai.abuse"))
      .all();
    expect(abuse.length).toBeGreaterThan(0);
    const statuses = (await db.select().from(schema.aiUsage).all()).map((u) => u.status);
    expect(statuses).toEqual(expect.arrayContaining(["timeout", "blocked"]));
  });

  it("opens the circuit after five consecutive failures and then fails fast", async () => {
    await enableAi();
    const provider = failing("malformed");
    setAiProviderOverride(provider);
    for (let i = 0; i < 5; i++) await appError(publicAsk());
    expect(provider.requests).toHaveLength(5);
    const error = await appError(publicAsk());
    expect(error.publicMessage).toBe(AI_USER_MESSAGES.unavailable);
    expect(provider.requests).toHaveLength(5); // not called while open
  });

  it("enforces the daily request budget", async () => {
    const used = (await db.select().from(schema.aiUsage).all()).length;
    await enableAi({ dailyRequestLimit: used + 1 });
    const provider = answer();
    await publicAsk(provider);
    const error = await appError(publicAsk(provider));
    expect(error.code).toBe("rate_limited");
    expect(error.publicMessage).toBe(AI_USER_MESSAGES.quota);
    expect(provider.requests).toHaveLength(1);
  });

  it("limits message size and conversation length before calling the provider", async () => {
    await enableAi({ maxInputChars: 100, maxTurns: 2 });
    const provider = answer();
    setAiProviderOverride(provider);
    const ctx = () => makeCtx({ ip: uniqueIp() });
    const long = await appError(
      runAi(ctx(), { channel: "public", actor: null, system: "s", messages: ask("x".repeat(101)) }),
    );
    expect(long.code).toBe("validation_failed");
    const many = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "hi",
    }));
    expect(
      (
        await appError(
          runAi(ctx(), { channel: "public", actor: null, system: "s", messages: many }),
        )
      ).code,
    ).toBe("validation_failed");
    expect(
      (await appError(runAi(ctx(), { channel: "public", actor: null, system: "s", messages: [] })))
        .code,
    ).toBe("validation_failed");
    expect(provider.requests).toHaveLength(0);
  });

  it("requires ai.use for admin tools", async () => {
    await enableAi();
    setAiProviderOverride(answer());
    const member = await actorFor((await createUser({ roles: ["member"] })).id);
    const denied = await appError(
      runAi(makeCtx({ ip: uniqueIp() }), {
        channel: "admin",
        actor: member,
        system: "s",
        messages: ask(),
      }),
    );
    expect(denied.code).toBe("forbidden");
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    const ok = await runAi(makeCtx({ ip: uniqueIp() }), {
      channel: "admin",
      actor: staff,
      system: "s",
      messages: ask(),
    });
    expect(ok.text).toContain("VORA");
  });

  it("reports provider health and caches it", async () => {
    await enableAi();
    expect(await aiHealth(makeCtx())).toMatchObject({ configured: false, ok: false });
    const provider = answer();
    setAiProviderOverride(provider);
    expect(await aiHealth(makeCtx())).toMatchObject({
      configured: true,
      ok: true,
      model: "gemini-3.8-flash",
    });
    await aiHealth(makeCtx());
    expect(provider.healthChecks).toBe(1);
  });
});
