/**
 * Platform-neutral names for the two execution types the application and its tests use. On
 * Workers these came from the generated `worker-configuration.d.ts`; on Railway the Node server
 * (`server/platform/background.ts`, `server/platform/scheduler.ts`) supplies objects of these
 * shapes, so the kernel, the jobs and the tests keep their signatures.
 */
declare global {
  /** Keeps background work alive after a response is sent; the Node server drains it on SIGTERM. */
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
    /** Part of the Workers/Hono shape; VORA never reads it (always an empty object). */
    readonly props: unknown;
  }

  /** One firing of a scheduled job (`*\/5 * * * *` or `17 3 * * *`, UTC). */
  interface ScheduledController {
    readonly cron: string;
    readonly scheduledTime: number;
    noRetry(): void;
  }
}

export {};
