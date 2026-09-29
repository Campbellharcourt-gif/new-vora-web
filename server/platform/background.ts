/**
 * Background work that outlives a response (email sends, session touches, security logs) —
 * the replacement for Workers' `ExecutionContext.waitUntil` (Railway migration §2 item 12, §8).
 *
 * Every promise is tracked until it settles. A failure is logged, never thrown into a request.
 * On SIGTERM the server drains the tracker (bounded), so work in flight finishes before exit; a
 * task that is cut off anyway loses nothing durable — the email outbox retries it on the next run.
 */
export type BackgroundErrorHandler = (error: unknown) => void;

export class BackgroundTasks {
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;

  constructor(private readonly onError: BackgroundErrorHandler = () => {}) {}

  /** Tracks a promise. After shutdown has started, new work is still tracked (and awaited). */
  track(promise: Promise<unknown>): void {
    const tracked = promise.then(
      () => undefined,
      (error: unknown) => {
        try {
          this.onError(error);
        } catch {
          // a failing error handler must not become an unhandled rejection
        }
      },
    );
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  get size(): number {
    return this.pending.size;
  }

  get draining(): boolean {
    return this.closed;
  }

  /**
   * Waits until nothing is pending (including work queued while waiting) or the timeout passes.
   * Resolves true when everything settled.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    this.closed = true;
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), remaining);
      });
      const result = await Promise.race([Promise.allSettled([...this.pending]), timedOut]);
      clearTimeout(timer);
      if (result === "timeout") return this.pending.size === 0;
    }
    return true;
  }

  /** An ExecutionContext for one request or job, backed by this tracker. */
  context(): ExecutionContext {
    return {
      waitUntil: (promise: Promise<unknown>) => this.track(promise),
      passThroughOnException: () => {},
      props: {},
    };
  }
}
