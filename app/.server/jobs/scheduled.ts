import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { syncRbac } from "../auth/rbac";
import type { WorkerEnv } from "../config/env";
import { createJobContext, type ServerContext } from "../context";
import { affectedRows, schema } from "../db/client";
import { deliverDue } from "../email/outbox";
import { newId } from "../lib/ids";
import { DAY } from "../lib/time";
import { describeError } from "../observability/logger";
import { getSetting } from "../services/settings";

/** Runs one job with a `job_runs` record; a failing job is recorded and logged, never thrown. */
export async function runJob(
  ctx: ServerContext,
  job: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<void> {
  const id = newId("job", ctx.clock.now());
  await ctx.db
    .insert(schema.jobRuns)
    .values({ id, job, status: "running", startedAt: ctx.clock.now() });
  try {
    const details = await fn();
    await ctx.db
      .update(schema.jobRuns)
      .set({ status: "ok", finishedAt: ctx.clock.now(), details })
      .where(eq(schema.jobRuns.id, id));
    ctx.log.info("job_ok", { job, ...details });
  } catch (error) {
    await ctx.db
      .update(schema.jobRuns)
      .set({
        status: "failed",
        finishedAt: ctx.clock.now(),
        details: { error: String(error).slice(0, 500) },
      })
      .where(eq(schema.jobRuns.id, id));
    ctx.log.error("job_failed", { job, ...describeError(error) });
  }
}

/**
 * Emails one five-minute run may send. Back to the CP-2.1 value of 25 on Railway (migration §8):
 * CP-3 lowered it to 10 only to fit a Workers Free invocation's 50-query/50-subrequest limits,
 * which an ordinary Node process does not have. Nothing is lost or sent twice when a run is cut
 * short (a restart or deploy): each email is claimed and settled on its own, a stuck claim is
 * retried after 10 minutes, and the provider deduplicates by idempotency key. Ordinary emails
 * never wait for this job — they are sent straight after the request that queues them.
 */
export const EMAIL_RETRY_BATCH = 25;

/** Every 5 minutes: deliver queued/failed emails with backoff. */
export async function emailRetryJob(ctx: ServerContext): Promise<void> {
  await runJob(ctx, "email-retry", async () => deliverDue(ctx, EMAIL_RETRY_BATCH));
}

/** Daily: expire auth artefacts and apply retention settings. */
export async function dailyJob(ctx: ServerContext): Promise<void> {
  await runJob(ctx, "daily", async () => {
    const now = ctx.clock.now();
    const retention = await getSetting(ctx, "retention");
    const rbacSynced = await syncRbac(ctx.db, now);

    const sessions = await ctx.db
      .delete(schema.sessions)
      .where(
        or(
          lt(schema.sessions.expiresAt, now - DAY),
          and(isNotNull(schema.sessions.revokedAt), lt(schema.sessions.revokedAt, now - 30 * DAY)),
        ),
      )
      .run();
    const challenges = await ctx.db
      .delete(schema.mfaChallenges)
      .where(lt(schema.mfaChallenges.expiresAt, now - DAY))
      .run();
    const tokens = await ctx.db
      .delete(schema.authTokens)
      .where(lt(schema.authTokens.expiresAt, now - 7 * DAY))
      .run();
    const invites = await ctx.db
      .delete(schema.invitations)
      .where(lt(schema.invitations.expiresAt, now - 30 * DAY))
      .run();
    const attempts = await ctx.db
      .delete(schema.loginAttempts)
      .where(lt(schema.loginAttempts.createdAt, now - retention.loginHistoryDays * DAY))
      .run();
    const outbox = await ctx.db
      .delete(schema.emailOutbox)
      .where(
        and(
          lt(schema.emailOutbox.createdAt, now - retention.emailOutboxDays * DAY),
          or(eq(schema.emailOutbox.status, "sent"), eq(schema.emailOutbox.status, "dead")),
        ),
      )
      .run();
    const conversations = await ctx.db
      .delete(schema.aiConversations)
      .where(lt(schema.aiConversations.retentionUntil, now))
      .run();
    // Enquiries past retention are anonymised (kept for aggregate reporting), never silently kept.
    const enquiries = await ctx.db
      .update(schema.enquiries)
      .set({
        name: "[removed]",
        email: "removed@invalid",
        company: null,
        websiteUrl: null,
        message: "[removed after retention period]",
        userAgent: null,
        ipHash: null,
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          isNotNull(schema.enquiries.retentionUntil),
          lt(schema.enquiries.retentionUntil, now),
          inArray(schema.enquiries.status, ["won", "lost", "archived"]),
        ),
      )
      .run();
    const jobs = await ctx.db
      .delete(schema.jobRuns)
      .where(lt(schema.jobRuns.startedAt, now - 30 * DAY))
      .run();

    return {
      rbacSynced,
      sessionsDeleted: affectedRows(sessions),
      challengesDeleted: affectedRows(challenges),
      tokensDeleted: affectedRows(tokens),
      invitationsDeleted: affectedRows(invites),
      loginAttemptsDeleted: affectedRows(attempts),
      outboxDeleted: affectedRows(outbox),
      aiConversationsDeleted: affectedRows(conversations),
      enquiriesAnonymised: affectedRows(enquiries),
      jobRunsDeleted: affectedRows(jobs),
    };
  });
}

/**
 * The two schedules (UTC), unchanged from the Cloudflare cron triggers. The Node server's
 * in-process scheduler (server/platform/scheduler.ts) fires `runScheduled` with these strings.
 */
export const JOB_SCHEDULES = ["*/5 * * * *", "17 3 * * *"] as const;

export async function runScheduled(
  controller: ScheduledController,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  const jobCtx = createJobContext({
    env,
    job: controller.cron,
    waitUntil: (p) => ctx.waitUntil(p),
  });
  if (controller.cron === "*/5 * * * *") await emailRetryJob(jobCtx);
  else await dailyJob(jobCtx);
}
