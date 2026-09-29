import type { RateLimiter } from "../../app/.server/platform/types";

/**
 * In-process sliding-window rate limiter with the Workers Rate Limiting binding's call shape
 * (`limit({ key }) → { success }`) — Railway migration §2 item 10.
 *
 * Exact, because VORA runs as one instance (the SQLite volume allows no replicas): each key keeps
 * the timestamps of its accepted requests within the window, at most `limit` of them, so a key can
 * never exceed `limit` requests in any `periodMs` interval. Memory is bounded: at most `maxKeys`
 * keys (the least recently used are dropped first) and expired keys are swept periodically. A
 * restart clears the counters; the account throttles in the database persist.
 */
export interface LimiterConfig {
  limit: number;
  periodMs: number;
  /** Upper bound on tracked keys. */
  maxKeys?: number;
  now?: () => number;
}

export class SlidingWindowLimiter implements RateLimiter {
  readonly limitPerWindow: number;
  readonly periodMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  /** Insertion order = recency order (a hit re-inserts the key). */
  private readonly hits = new Map<string, number[]>();

  constructor(config: LimiterConfig) {
    if (!(config.limit > 0) || !(config.periodMs > 0)) throw new Error("Invalid limiter config");
    this.limitPerWindow = config.limit;
    this.periodMs = config.periodMs;
    this.maxKeys = config.maxKeys ?? 50_000;
    this.now = config.now ?? Date.now;
  }

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    return { success: this.take(key) };
  }

  /** Synchronous core, for tests. */
  take(key: string): boolean {
    const now = this.now();
    const cutoff = now - this.periodMs;
    const previous = this.hits.get(key);
    const recent = previous ? previous.filter((t) => t > cutoff) : [];
    this.hits.delete(key);
    if (recent.length >= this.limitPerWindow) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    return true;
  }

  /** Drops keys with no request inside the window. */
  sweep(): void {
    const cutoff = this.now() - this.periodMs;
    for (const [key, times] of this.hits) {
      if ((times.at(-1) ?? 0) <= cutoff) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}

/** The four limiters and their limits — identical to the Workers binding configuration. */
export const LIMITS = {
  RL_AUTH: { limit: 20, periodMs: 60_000 },
  RL_FORMS: { limit: 6, periodMs: 60_000 },
  RL_API: { limit: 120, periodMs: 60_000 },
  RL_AI: { limit: 12, periodMs: 60_000 },
} as const;

export type LimiterSet = { [K in keyof typeof LIMITS]: SlidingWindowLimiter };

export function createLimiters(options: { now?: () => number; maxKeys?: number } = {}): LimiterSet {
  const make = (name: keyof typeof LIMITS) =>
    new SlidingWindowLimiter({ ...LIMITS[name], ...options });
  return {
    RL_AUTH: make("RL_AUTH"),
    RL_FORMS: make("RL_FORMS"),
    RL_API: make("RL_API"),
    RL_AI: make("RL_AI"),
  };
}

/** Sweeps every limiter each minute; returns a stop function. */
export function startLimiterSweeps(limiters: LimiterSet, everyMs = 60_000): () => void {
  const timer = setInterval(() => {
    for (const limiter of Object.values(limiters)) limiter.sweep();
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
