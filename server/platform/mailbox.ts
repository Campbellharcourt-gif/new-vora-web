import type { DevMailbox } from "../../app/.server/platform/types";

/**
 * Development/test mailbox for the capture email transport (Railway migration §2 item 9),
 * replacing the `DEV_MAILBOX` KV namespace with the same call shape. It lives in the server's
 * memory: nothing is written to disk, entries expire, and the store is bounded.
 *
 * It is only ever created in development and test (server/platform/env.ts). `/api/dev/mailbox`
 * keeps answering 404 in staging and production, and the capture transport is refused there by
 * configuration validation — both unchanged.
 */
export class MemoryMailbox implements DevMailbox {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  async put(key: string, value: string, options: { expirationTtl?: number } = {}): Promise<void> {
    const ttlMs = Math.max(60, options.expirationTtl ?? 86_400) * 1000;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async list(options: { prefix?: string } = {}): Promise<{ keys: { name: string }[] }> {
    const now = this.now();
    const keys: { name: string }[] = [];
    for (const [name, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(name);
        continue;
      }
      if (!options.prefix || name.startsWith(options.prefix)) keys.push({ name });
    }
    // KV lists keys in lexicographic order.
    keys.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { keys };
  }
}
