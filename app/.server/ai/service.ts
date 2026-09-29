import { gte, sql } from "drizzle-orm";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { AppError } from "../lib/errors";
import { newId } from "../lib/ids";
import { describeError } from "../observability/logger";
import { recordSecurityEvent } from "../observability/security-events";
import { isFlagEnabled } from "../services/flags";
import { checkRateLimit } from "../services/rate-limit";
import { getSetting, type SettingValue } from "../services/settings";
import { GEMINI_DEFAULT_BASE_URL, GeminiProvider } from "./gemini";
import {
  AI_USER_MESSAGES,
  AiError,
  type AiErrorKind,
  type AiHealth,
  type AiMessage,
  type AiProvider,
} from "./types";

export type AiChannel = "public" | "admin";
type AiConfig = SettingValue<"ai.config">;

let providerOverride: AiProvider | null = null;
/** Tests inject a fake provider; production always builds the configured adapter. */
export function setAiProviderOverride(provider: AiProvider | null): void {
  providerOverride = provider;
  circuit.failures = 0;
  circuit.openUntil = 0;
}

export function getAiProvider(ctx: ServerContext, config: AiConfig): AiProvider | null {
  if (providerOverride) return providerOverride;
  if (config.provider === "gemini" && ctx.config.ai.geminiApiKey) {
    return new GeminiProvider(
      ctx.config.ai.geminiApiKey,
      ctx.config.ai.gatewayBaseUrl ?? GEMINI_DEFAULT_BASE_URL,
    );
  }
  return null;
}

/** Simple circuit breaker: 5 consecutive provider failures → fail fast for 60 seconds. */
const circuit = { failures: 0, openUntil: 0 };
const CIRCUIT = { threshold: 5, cooldownMs: 60_000 } as const;

export function aiCircuitState() {
  return { ...circuit, open: circuit.openUntil > Date.now() };
}

function userError(
  kind: AiErrorKind | "disabled" | "quota",
  internal?: Record<string, unknown>,
): AppError {
  const code = kind === "quota" || kind === "rate_limited" ? "rate_limited" : "service_unavailable";
  return new AppError(code, { message: AI_USER_MESSAGES[kind], ...(internal ? { internal } : {}) });
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function usageToday(ctx: ServerContext) {
  const row = await ctx.db
    .select({
      requests: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(coalesce(${schema.aiUsage.inputTokens}, 0) + coalesce(${schema.aiUsage.outputTokens}, 0)), 0)`,
    })
    .from(schema.aiUsage)
    .where(gte(schema.aiUsage.createdAt, startOfUtcDay(ctx.clock.now())))
    .get();
  return { requests: Number(row?.requests ?? 0), tokens: Number(row?.tokens ?? 0) };
}

async function recordUsage(
  ctx: ServerContext,
  entry: {
    channel: AiChannel;
    userId: string | null;
    conversationId?: string | null;
    provider: string;
    model: string;
    status: "ok" | "error" | "timeout" | "rate_limited" | "blocked" | "malformed" | "disabled";
    errorCode?: string | null;
    latencyMs?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    config: AiConfig;
  },
): Promise<void> {
  const cost =
    entry.inputTokens != null || entry.outputTokens != null
      ? Math.round(
          (entry.inputTokens ?? 0) * entry.config.priceInputPerMTokUsd +
            (entry.outputTokens ?? 0) * entry.config.priceOutputPerMTokUsd,
        )
      : null;
  try {
    await ctx.db.insert(schema.aiUsage).values({
      id: newId("aiUsage", ctx.clock.now()),
      conversationId: entry.conversationId ?? null,
      userId: entry.userId,
      channel: entry.channel,
      provider: entry.provider,
      model: entry.model,
      status: entry.status,
      errorCode: entry.errorCode ?? null,
      latencyMs: entry.latencyMs ?? null,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      costMicroUsd: cost,
      createdAt: ctx.clock.now(),
    });
  } catch (error) {
    ctx.log.error("ai_usage_record_failed", describeError(error));
  }
}

const STATUS_FOR_KIND: Record<
  AiErrorKind,
  "error" | "timeout" | "rate_limited" | "blocked" | "malformed"
> = {
  timeout: "timeout",
  rate_limited: "rate_limited",
  unavailable: "error",
  blocked: "blocked",
  malformed: "malformed",
  config: "error",
  bad_request: "error",
};

/**
 * Runs one AI completion behind every guard: channel switch + feature flag, provider configured,
 * circuit breaker, per-IP/per-user rate limits, daily request/token budgets, input size and turn
 * limits, timeout, one retry for transient failures, and a usage ledger entry for every outcome.
 * Always resolves to text or throws an AppError with a safe, user-facing message.
 */
export async function runAi(
  ctx: ServerContext,
  input: {
    channel: AiChannel;
    actor: Actor | null;
    system: string;
    messages: AiMessage[];
    conversationId?: string;
  },
): Promise<{ text: string }> {
  const config = await getSetting(ctx, "ai.config");
  const base = {
    channel: input.channel,
    userId: input.actor?.userId ?? null,
    provider: config.provider,
    model: config.model,
    config,
  };

  const channelOn = input.channel === "public" ? config.publicEnabled : config.adminEnabled;
  const flagOn = await isFlagEnabled(
    ctx,
    input.channel === "public" ? "ai.public_assistant" : "ai.admin_tools",
    input.actor,
  );
  if (!channelOn || !flagOn) throw userError("disabled");
  if (input.channel === "admin" && !input.actor?.permissions.has("ai.use")) {
    throw new AppError("forbidden");
  }

  const provider = getAiProvider(ctx, config);
  if (!provider) {
    ctx.log.error("ai_not_configured", { provider: config.provider });
    throw userError("config");
  }
  if (circuit.openUntil > Date.now()) throw userError("unavailable", { circuit: "open" });

  const subject = input.actor ? `user:${input.actor.userId}` : undefined;
  if (!(await checkRateLimit(ctx, "RL_AI", `ai-${input.channel}`, subject))) {
    await recordUsage(ctx, { ...base, status: "rate_limited", errorCode: "local_rate_limit" });
    throw userError("rate_limited");
  }

  const today = await usageToday(ctx);
  if (today.requests >= config.dailyRequestLimit || today.tokens >= config.dailyTokenLimit) {
    ctx.log.warn("ai_daily_budget_reached", today);
    throw userError("quota");
  }

  if (input.messages.length === 0 || input.messages.length > config.maxTurns * 2) {
    throw new AppError("validation_failed", {
      message: "This conversation is too long. Please start a new one.",
    });
  }
  for (const message of input.messages) {
    if (message.content.length > config.maxInputChars) {
      throw new AppError("validation_failed", {
        message: `Please keep messages under ${config.maxInputChars} characters.`,
      });
    }
  }

  const request = {
    model: config.model,
    system: input.system,
    messages: input.messages,
    maxOutputTokens: config.maxOutputTokens,
    thinkingLevel: config.thinkingLevel,
    timeoutMs: config.requestTimeoutMs,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const result = await provider.generate(request);
      circuit.failures = 0;
      await recordUsage(ctx, {
        ...base,
        conversationId: input.conversationId ?? null,
        status: "ok",
        latencyMs: Date.now() - started,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      return { text: result.text };
    } catch (error) {
      const aiError =
        error instanceof AiError
          ? error
          : new AiError("unavailable", "Unknown AI failure", { cause: error });
      await recordUsage(ctx, {
        ...base,
        conversationId: input.conversationId ?? null,
        status: STATUS_FOR_KIND[aiError.kind],
        errorCode: aiError.kind,
        latencyMs: Date.now() - started,
      });
      ctx.log.error("ai_request_failed", {
        kind: aiError.kind,
        status: aiError.status,
        attempt,
        provider: provider.name,
      });
      if (aiError.kind === "blocked" && input.channel === "public") {
        await recordSecurityEvent(ctx, {
          type: "ai.abuse",
          severity: "low",
          details: { reason: "blocked" },
        });
      }
      if (
        aiError.kind === "unavailable" ||
        aiError.kind === "timeout" ||
        aiError.kind === "malformed"
      ) {
        circuit.failures += 1;
        if (circuit.failures >= CIRCUIT.threshold)
          circuit.openUntil = Date.now() + CIRCUIT.cooldownMs;
      }
      const retry =
        attempt === 1 && aiError.kind === "unavailable" && circuit.openUntil <= Date.now();
      if (!retry) throw userError(aiError.kind);
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 400)));
    }
  }
  throw userError("unavailable");
}

const healthCache: { value: AiHealth | null; at: number } = { value: null, at: 0 };

/** Provider health (cached 60 s so status pages never hammer the provider). */
export async function aiHealth(
  ctx: ServerContext,
): Promise<AiHealth & { configured: boolean; model: string }> {
  const config = await getSetting(ctx, "ai.config");
  const provider = getAiProvider(ctx, config);
  if (!provider)
    return { ok: false, latencyMs: 0, configured: false, model: config.model, detail: "config" };
  if (healthCache.value && Date.now() - healthCache.at < 60_000) {
    return { ...healthCache.value, configured: true, model: config.model };
  }
  const health = await provider.health(config.model);
  healthCache.value = health;
  healthCache.at = Date.now();
  return { ...health, configured: true, model: config.model };
}

export function clearAiHealthCache(): void {
  healthCache.value = null;
  healthCache.at = 0;
}
