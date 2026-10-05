import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSession } from "~/.server/auth/sessions";
import { deliverDue } from "~/.server/email/outbox";
import { runJob, runScheduled } from "~/.server/jobs/scheduled";
import { newId } from "~/.server/lib/ids";
import { submitEnquiry } from "~/.server/services/enquiries";
import { issueFormToken } from "~/.server/services/form-token";
import {
  actorFor,
  call,
  createUser,
  db,
  makeCtx,
  manualClock,
  schema,
  testEnv,
  uniqueEmail,
  uniqueIp,
} from "../support/helpers";

const DAY = 86_400_000;
const MINUTE = 60_000;

async function cron(expression: string) {
  const ctx = createExecutionContext();
  await runScheduled(
    { cron: expression, scheduledTime: Date.now(), noRetry() {} } as ScheduledController,
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

type Status = {
  overall: string;
  components: { name: string; state: string; detail?: string; latencyMs?: number }[];
};

describe("health endpoints", () => {
  it("serves liveness and readiness", async () => {
    expect(await (await call("/api/health")).json()).toEqual({ status: "ok" });
    const ready = await call("/api/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });

  it("publishes a minimal public status with no internals", async () => {
    const res = await call("/api/v1/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
    const body = (await res.json()) as Status;
    expect(body.components.map((c) => c.name).sort()).toEqual(
      ["Email notifications", "Media & files", "VORA AI", "Website & portals"].sort(),
    );
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/latencyMs|detail|migrations|GEMINI|TURNSTILE|RESEND/);
  });

  it("restricts detailed status to holders of system.status", async () => {
    expect((await call("/api/v1/system/status")).status).toBe(401);
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    expect((await call("/api/v1/system/status", { token: staff.token })).status).toBe(403);

    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const res = await call("/api/v1/system/status", { token: admin.token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Status;
    const byName = Object.fromEntries(body.components.map((c) => [c.name, c]));
    const migrationCount = readdirSync("migrations").filter((f) => f.endsWith(".sql")).length;
    expect(byName.database).toMatchObject({
      state: "operational",
      detail: `${migrationCount} migrations applied`,
    });
    expect(byName.storage?.state).toBe("operational");
    expect(byName.ai).toMatchObject({ state: "not_configured" });
    expect(byName.configuration?.state).toBe("degraded");
    expect(byName.configuration?.detail).toContain("TURNSTILE_SECRET_KEY");
    expect(byName.configuration?.detail).not.toContain(testEnv.AUTH_SECRET ?? "never");
    expect(byName.jobs?.state).toBe("degraded"); // no scheduled run recorded yet
    expect(body.overall).toBe("degraded");
  });

  it("reports scheduled jobs as on schedule once they have run", async () => {
    await cron("*/5 * * * *");
    await cron("17 3 * * *");
    const runs = await db.select().from(schema.jobRuns).all();
    expect(runs.map((r) => `${r.job}:${r.status}`).sort()).toEqual(["daily:ok", "email-retry:ok"]);
    const admin = await actorFor((await createUser({ roles: ["owner"] })).id);
    const body = (await (
      await call("/api/v1/system/status", { token: admin.token })
    ).json()) as Status;
    expect(body.components.find((c) => c.name === "jobs")?.state).toBe("operational");
  });
});

describe("scheduled jobs", () => {
  it("delivers due outbox mail on the five-minute schedule", async () => {
    const now = Date.now();
    const id = newId("email", now);
    await db.insert(schema.emailOutbox).values({
      id,
      template: "securityNotice",
      toEmail: uniqueEmail(),
      subject: "Security notice: Test",
      payload: {
        data: { name: "A", heading: "Test", message: "M", url: "http://localhost:5173/account" },
        replyTo: null,
      },
      status: "failed",
      attempts: 1,
      nextAttemptAt: now - MINUTE,
      idempotencyKey: id,
      createdAt: now - 2 * MINUTE,
      updatedAt: now - 2 * MINUTE,
    });
    await cron("*/5 * * * *");
    const row = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.id, id))
      .get();
    expect(row).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("applies retention daily: expires auth artefacts and anonymises closed enquiries only", async () => {
    const now = Date.now();
    const user = await createUser({ roles: ["member"] });
    const oldCtx = makeCtx({ clock: manualClock(now - 40 * DAY) });
    const expired = await createSession(oldCtx, {
      userId: user.id,
      authLevel: "full",
      authMethod: "test",
      privileged: false,
      mfaVerified: false,
    });
    const live = await createSession(makeCtx(), {
      userId: user.id,
      authLevel: "full",
      authMethod: "test",
      privileged: false,
      mfaVerified: false,
    });
    await db.insert(schema.loginAttempts).values([
      {
        id: newId("loginAttempt", now),
        userId: user.id,
        outcome: "success",
        createdAt: now - 200 * DAY,
      },
      { id: newId("loginAttempt", now), userId: user.id, outcome: "success", createdAt: now - DAY },
    ]);

    const references: string[] = [];
    for (let i = 0; i < 2; i++) {
      const tokenCtx = makeCtx({ clock: manualClock(now - 10_000) });
      const outcome = await submitEnquiry(makeCtx({ ip: uniqueIp() }), {
        formToken: await issueFormToken(tokenCtx, "enquiry"),
        fields: {
          name: `Past Client ${i}`,
          email: uniqueEmail("past"),
          projectTypes: ["websites"],
          timeline: "flexible",
          message: "An enquiry old enough to pass its retention period.",
          consent: true,
        },
      });
      if (outcome.kind !== "accepted") throw new Error("not accepted");
      references.push(outcome.reference);
    }
    await db
      .update(schema.enquiries)
      .set({ retentionUntil: now - DAY, status: "lost" })
      .where(eq(schema.enquiries.reference, references[0] ?? ""));
    await db
      .update(schema.enquiries)
      .set({ retentionUntil: now - DAY }) // still "received": needs a human decision first
      .where(eq(schema.enquiries.reference, references[1] ?? ""));
    await deliverDue(makeCtx());
    const auditBefore = (await db.select().from(schema.auditLogs).all()).length;

    await cron("17 3 * * *");

    const sessions = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id))
      .all();
    expect(sessions.map((s) => s.id)).toEqual([live.sessionId]);
    expect(sessions.map((s) => s.id)).not.toContain(expired.sessionId);
    const attempts = await db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.userId, user.id))
      .all();
    expect(attempts).toHaveLength(1);

    const anonymised = await db
      .select()
      .from(schema.enquiries)
      .where(eq(schema.enquiries.reference, references[0] ?? ""))
      .get();
    expect(anonymised).toMatchObject({
      name: "[removed]",
      email: "removed@invalid",
      message: "[removed after retention period]",
      ipHash: null,
    });
    expect(anonymised?.deletedAt).not.toBeNull();
    const kept = await db
      .select()
      .from(schema.enquiries)
      .where(eq(schema.enquiries.reference, references[1] ?? ""))
      .get();
    expect(kept?.name).toBe("Past Client 1");

    const run = await db
      .select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.job, "daily"))
      .orderBy(schema.jobRuns.startedAt)
      .all();
    expect(run.at(-1)?.status).toBe("ok");
    expect(run.at(-1)?.details).toMatchObject({ enquiriesAnonymised: 1, loginAttemptsDeleted: 1 });
    expect((await db.select().from(schema.auditLogs).all()).length).toBe(auditBefore);
  });

  it("records a failing job as failed instead of crashing the scheduler", async () => {
    await expect(
      runJob(makeCtx(), "probe", async () => {
        throw new Error("simulated failure");
      }),
    ).resolves.toBeUndefined();
    const run = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, "probe")).get();
    expect(run?.status).toBe("failed");
    expect(run?.finishedAt).not.toBeNull();
    expect(JSON.stringify(run?.details)).toContain("simulated failure");
  });
});
