import { Cron } from "croner";

/**
 * In-process UTC scheduler (Railway migration §8) replacing Cloudflare Cron Triggers. It fires the
 * application's existing `runScheduled` with the same cron strings. Rules:
 *
 * - **UTC**, whatever the machine's time zone.
 * - **No overlap.** A job that is still running when its next firing comes is skipped (and
 *   logged), never started twice. One volume ⇒ one instance ⇒ no second scheduler elsewhere.
 * - **Never throws.** A failing run is logged; the job records its own failure in `job_runs`.
 * - **Clean shutdown.** `stop()` cancels future firings and waits (bounded) for runs in flight.
 */
export type RunJob = (controller: ScheduledController) => Promise<void>;

export interface SchedulerLog {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export class JobScheduler {
  private readonly running = new Map<string, Promise<void>>();
  private readonly crons: Cron[] = [];
  private stopped = false;

  constructor(
    readonly schedules: readonly string[],
    private readonly run: RunJob,
    private readonly log: SchedulerLog,
  ) {
    for (const pattern of schedules) {
      // Throws on an invalid pattern — at start-up, not at 03:17.
      new Cron(pattern, { timezone: "UTC", mode: "5-part", paused: true });
    }
  }

  start(): void {
    if (this.stopped) throw new Error("Scheduler already stopped");
    for (const pattern of this.schedules) {
      this.crons.push(
        new Cron(pattern, { timezone: "UTC", mode: "5-part", unref: true }, () => {
          void this.fire(pattern, Date.now());
        }),
      );
    }
    this.log.info("scheduler_started", {
      jobs: this.schedules.map((pattern) => ({ pattern, next: this.nextRun(pattern) })),
    });
  }

  /** Next firing of a pattern (UTC), for logs and tests. */
  nextRun(pattern: string, from?: Date): string | null {
    const next = new Cron(pattern, { timezone: "UTC", mode: "5-part", paused: true }).nextRun(
      from ?? new Date(),
    );
    return next ? next.toISOString() : null;
  }

  /** Runs one firing unless the same job is still running. Resolves when that run ends. */
  fire(pattern: string, scheduledTime: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const inFlight = this.running.get(pattern);
    if (inFlight) {
      this.log.warn("job_skipped_overlap", { cron: pattern });
      return inFlight;
    }
    const controller: ScheduledController = {
      cron: pattern,
      scheduledTime,
      noRetry() {},
    };
    const runPromise = (async () => {
      try {
        await this.run(controller);
      } catch (error) {
        this.log.error("scheduled_run_failed", {
          cron: pattern,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.running.delete(pattern);
      }
    })();
    this.running.set(pattern, runPromise);
    return runPromise;
  }

  isRunning(pattern: string): boolean {
    return this.running.has(pattern);
  }

  /** Stops future firings and waits up to `timeoutMs` for runs in flight. */
  async stop(timeoutMs: number): Promise<boolean> {
    this.stopped = true;
    for (const cron of this.crons) cron.stop();
    this.crons.length = 0;
    if (this.running.size === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const done = Promise.allSettled([...this.running.values()]).then(() => true as const);
    const finished = await Promise.race([done, timeout]);
    clearTimeout(timer);
    return finished;
  }
}
