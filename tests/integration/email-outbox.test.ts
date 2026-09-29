import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { deliverDue, deliverQueued, enqueueEmail, sendSensitive } from "~/.server/email/outbox";
import {
  type EmailMessage,
  EmailSendError,
  type EmailTransport,
  type SendResult,
  setEmailTransportOverride,
} from "~/.server/email/transport";
import { newId } from "~/.server/lib/ids";
import { checkEmail } from "~/.server/services/health";
import { db, makeCtx, manualClock, schema, uniqueEmail } from "../support/helpers";

const MINUTE = 60_000;

class ScriptedTransport implements EmailTransport {
  readonly name = "resend" as const;
  calls: EmailMessage[] = [];
  constructor(private readonly script: (call: number) => SendResult | Error) {}
  async send(message: EmailMessage): Promise<SendResult> {
    this.calls.push(message);
    const outcome = this.script(this.calls.length);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

const transient = () =>
  new EmailSendError("Resend 503: unavailable", { retryable: true, providerStatus: 503 });
const permanent = () =>
  new EmailSendError("Resend 422: validation_error", { retryable: false, providerStatus: 422 });

function notice(to: string, idempotencyKey?: string) {
  return {
    template: "securityNotice" as const,
    to,
    data: {
      name: "Sam",
      heading: "Test",
      message: "Body",
      url: "http://localhost:5173/account/security",
    },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

async function outboxRow(id: string) {
  return db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, id)).get();
}

afterEach(() => setEmailTransportOverride(null));

describe("email outbox", () => {
  it("delivers queued mail after the response and records the provider id", async () => {
    const ctx = makeCtx();
    const id = await enqueueEmail(ctx, notice(uniqueEmail()));
    // Persisted before delivery finishes (delivery starts in the background immediately).
    expect(["queued", "sending"]).toContain((await outboxRow(id))?.status);
    await ctx.flush();
    const row = await outboxRow(id);
    expect(row).toMatchObject({ status: "sent", attempts: 1, lastError: null });
    expect(row?.providerMessageId).toMatch(/^capture_/);
    expect(row?.sentAt).not.toBeNull();
  });

  it("retries transient failures with backoff and dead-letters after six attempts", async () => {
    const transport = new ScriptedTransport(() => transient());
    setEmailTransportOverride(transport);
    const clock = manualClock();
    const ctx = makeCtx({ clock });
    const id = await enqueueEmail(ctx, notice(uniqueEmail()));
    await ctx.flush();
    let row = await outboxRow(id);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row?.nextAttemptAt).toBe(clock.now() + MINUTE);
    expect(row?.lastError).toContain("503");

    expect(await deliverQueued(makeCtx({ clock }), id)).toBe("skipped"); // not due yet

    const outcomes: string[] = [];
    for (const wait of [1, 5, 15, 60, 360]) {
      clock.advance(wait * MINUTE);
      outcomes.push(await deliverQueued(makeCtx({ clock }), id));
    }
    expect(outcomes).toEqual(["failed", "failed", "failed", "failed", "dead"]);
    row = await outboxRow(id);
    expect(row).toMatchObject({ status: "dead", attempts: 6, nextAttemptAt: null });
    expect(transport.calls).toHaveLength(6);
    clock.advance(24 * 60 * MINUTE);
    expect(await deliverQueued(makeCtx({ clock }), id)).toBe("skipped");
  });

  it("dead-letters permanent failures immediately", async () => {
    setEmailTransportOverride(new ScriptedTransport(() => permanent()));
    const ctx = makeCtx();
    const id = await enqueueEmail(ctx, notice(uniqueEmail()));
    await ctx.flush();
    expect(await outboxRow(id)).toMatchObject({ status: "dead", attempts: 1 });
  });

  it("recovers when the provider comes back, via the cron sweep", async () => {
    const transport = new ScriptedTransport((n) => (n === 1 ? transient() : { id: "re_ok" }));
    setEmailTransportOverride(transport);
    const clock = manualClock();
    const ctx = makeCtx({ clock });
    const id = await enqueueEmail(ctx, notice(uniqueEmail()));
    await ctx.flush();
    clock.advance(MINUTE);
    const counts = await deliverDue(makeCtx({ clock }));
    expect(counts.sent).toBeGreaterThanOrEqual(1);
    expect(await outboxRow(id)).toMatchObject({
      status: "sent",
      providerMessageId: "re_ok",
      attempts: 2,
    });
  });

  it("releases sends stuck after a crash", async () => {
    const now = Date.now();
    const id = newId("email", now);
    await db.insert(schema.emailOutbox).values({
      id,
      template: "securityNotice",
      toEmail: uniqueEmail(),
      subject: "Security notice: Test",
      payload: { data: notice("x@example.test").data, replyTo: null },
      status: "sending",
      attempts: 1,
      nextAttemptAt: now - 20 * MINUTE,
      idempotencyKey: id,
      createdAt: now - 20 * MINUTE,
      updatedAt: now - 11 * MINUTE,
    });
    await deliverDue(makeCtx());
    expect(await outboxRow(id)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("never queues the same logical email twice", async () => {
    const ctx = makeCtx();
    const to = uniqueEmail();
    await enqueueEmail(ctx, notice(to, "notice:once"));
    await enqueueEmail(ctx, notice(to, "notice:once"));
    await ctx.flush();
    const rows = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.toEmail, to))
      .all();
    expect(rows).toHaveLength(1);
  });
});

describe("sensitive email", () => {
  it("sends synchronously and keeps only redacted metadata", async () => {
    const to = uniqueEmail();
    const result = await sendSensitive(makeCtx(), {
      template: "loginCode",
      to,
      data: { name: "Sam", code: "314159", minutes: 10 },
    });
    expect(result).toEqual({ ok: true });
    const row = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.toEmail, to))
      .get();
    expect(row).toMatchObject({
      sensitive: true,
      status: "sent",
      subject: "Sign-in code",
      payload: { redacted: true },
    });
    expect(JSON.stringify(row)).not.toContain("314159");
  });

  it("retries once, reports failure, and is never re-sent by the cron sweep", async () => {
    const transport = new ScriptedTransport(() => transient());
    setEmailTransportOverride(transport);
    const to = uniqueEmail();
    const result = await sendSensitive(makeCtx(), {
      template: "passwordReset",
      to,
      data: { name: "Sam", url: "http://localhost:5173/reset-password/secret-token", minutes: 30 },
    });
    expect(result).toEqual({ ok: false });
    expect(transport.calls).toHaveLength(2);
    const row = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.toEmail, to))
      .get();
    expect(row?.status).toBe("dead");
    expect(JSON.stringify(row)).not.toContain("secret-token");
    setEmailTransportOverride(new ScriptedTransport(() => ({ id: "re_x" })));
    await deliverDue(makeCtx({ clock: manualClock(Date.now() + 60 * MINUTE) }));
    expect(
      (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, to)).get())
        ?.status,
    ).toBe("dead");
  });
});

describe("email health", () => {
  it("derives state from real delivery outcomes in the last hour", async () => {
    const clock = manualClock(Date.now() + 3 * 24 * 60 * MINUTE); // past every row written above
    const insert = async (status: "sent" | "dead") => {
      const id = newId("email", clock.now());
      await db.insert(schema.emailOutbox).values({
        id,
        template: "securityNotice",
        toEmail: uniqueEmail(),
        subject: "s",
        payload: {},
        status,
        idempotencyKey: id,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });
    };
    expect((await checkEmail(makeCtx({ clock }))).state).toBe("operational");
    for (let i = 0; i < 3; i++) await insert("dead");
    expect((await checkEmail(makeCtx({ clock }))).state).toBe("down");
    await insert("sent");
    expect((await checkEmail(makeCtx({ clock }))).state).toBe("degraded");
  });
});
