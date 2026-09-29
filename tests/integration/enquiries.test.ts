import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "~/.server/config/env";
import { AppError } from "~/.server/lib/errors";
import {
  addEnquiryNote,
  changeEnquiryStatus,
  getEnquiry,
  listEnquiries,
} from "~/.server/services/enquiries";
import { issueFormToken } from "~/.server/services/form-token";
import {
  actorFor,
  call,
  createUser,
  db,
  makeCtx,
  manualClock,
  SAME_ORIGIN,
  schema,
  sentTo,
  testEnv,
  uniqueEmail,
  uniqueIp,
} from "../support/helpers";

const TEAM = "projects@vorawebsites.store";

async function formToken(ageMs = 10_000): Promise<string> {
  return issueFormToken(makeCtx({ clock: manualClock(Date.now() - ageMs) }), "enquiry");
}

function fields(overrides: Record<string, unknown> = {}) {
  return {
    name: "Jordan Lee",
    email: uniqueEmail("client"),
    company: "Northwind",
    website: "northwind.example",
    projectTypes: ["websites", "branding"],
    timeline: "1_2_months",
    message: "We are planning a new website and would like to talk about scope and timing.",
    source: "referral",
    consent: true,
    ...overrides,
  };
}

async function submit(body: unknown, options: { ip?: string; env?: WorkerEnv } = {}) {
  return call("/api/v1/enquiries", {
    method: "POST",
    ip: options.ip ?? uniqueIp(),
    ...(options.env ? { env: options.env } : {}),
    headers: { ...SAME_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function enquiryByReference(reference: string) {
  return db.select().from(schema.enquiries).where(eq(schema.enquiries.reference, reference)).get();
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("public enquiry pipeline", () => {
  it("stores a valid enquiry, then notifies the team and confirms to the sender", async () => {
    const ip = uniqueIp();
    const f = fields({ email: uniqueEmail("Jordan").toUpperCase() });
    const res = await submit({ fields: f, formToken: await formToken() }, { ip });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; reference: string };
    expect(body.status).toBe("received");
    expect(body.reference).toMatch(/^VR-[0-9A-HJKMNP-TV-Z]{6}$/);

    const row = await enquiryByReference(body.reference);
    const email = String(f.email).toLowerCase();
    expect(row).toMatchObject({
      status: "received",
      email,
      name: "Jordan Lee",
      websiteUrl: "https://northwind.example",
      projectTypes: ["websites", "branding"],
      timelineKey: "1_2_months",
      timelineLabel: "1–2 months",
      sourceLabel: "Referral or word of mouth",
      budgetKey: null,
      spamScore: 0,
      turnstileOk: false, // no secret configured in tests → verification skipped, and recorded as such
    });
    expect(row?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(ip);
    expect(row?.consentAt).toBeGreaterThan(0);
    expect((row?.retentionUntil ?? 0) - (row?.createdAt ?? 0)).toBe(24 * 30 * 86_400_000);

    const events = await db
      .select()
      .from(schema.enquiryEvents)
      .where(eq(schema.enquiryEvents.enquiryId, row?.id ?? ""))
      .all();
    expect(events.map((e) => e.type)).toEqual(["received"]);

    const outbox = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.relatedId, row?.id ?? ""))
      .all();
    expect(outbox.map((o) => [o.template, o.toEmail, o.status]).sort()).toEqual(
      [
        ["enquiryConfirmation", email, "sent"],
        ["enquiryNotification", TEAM, "sent"],
      ].sort(),
    );
    const team = sentTo(TEAM).find((m) => m.subject.includes(body.reference));
    expect(team?.subject).toBe(`New enquiry ${body.reference} — Jordan Lee, Northwind`);
    expect(team?.replyTo).toBe(email);
    expect(team?.text).toContain("We are planning a new website");
    expect(sentTo(email).at(-1)?.text).toContain(body.reference);
  });

  it("treats a double-submitted form as one enquiry", async () => {
    const token = await formToken();
    const f = fields();
    const first = (await (await submit({ fields: f, formToken: token })).json()) as {
      reference: string;
    };
    const second = (await (await submit({ fields: f, formToken: token })).json()) as {
      reference: string;
    };
    expect(second.reference).toBe(first.reference);
    const rows = await db
      .select()
      .from(schema.enquiries)
      .where(eq(schema.enquiries.email, f.email))
      .all();
    expect(rows).toHaveLength(1);
    const outbox = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.relatedId, rows[0]?.id ?? ""))
      .all();
    expect(outbox).toHaveLength(2);
  });

  it("silently discards bot-shaped submissions (honeypot, instant submit)", async () => {
    const honey = fields();
    const trapped = await submit({
      fields: honey,
      formToken: await formToken(),
      honeypot: "http://spam.example",
    });
    expect(trapped.status).toBe(201);
    expect(await trapped.json()).toEqual({ status: "received" });
    const instant = fields();
    const fast = await submit({ fields: instant, formToken: await formToken(0) });
    expect(await fast.json()).toEqual({ status: "received" });
    for (const f of [honey, instant]) {
      expect(
        await db.select().from(schema.enquiries).where(eq(schema.enquiries.email, f.email)).all(),
      ).toHaveLength(0);
    }
    const spam = await db
      .select()
      .from(schema.securityEvents)
      .where(eq(schema.securityEvents.type, "spam.detected"))
      .all();
    expect(spam.map((s) => (s.details as { signal: string }).signal).sort()).toEqual([
      "honeypot",
      "too_fast",
    ]);
  });

  it("rejects forged or expired form tokens and returns field errors", async () => {
    const token = await formToken();
    const forged = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const bad = await submit({ fields: fields(), formToken: forged });
    expect(bad.status).toBe(422);
    expect(
      ((await bad.json()) as { error: { fields: Record<string, string> } }).error.fields,
    ).toHaveProperty("_form");
    const stale = await submit({ fields: fields(), formToken: await formToken(2 * 86_400_000) });
    expect(stale.status).toBe(422);

    const invalid = await submit({
      fields: fields({
        email: "nope",
        message: "short",
        consent: false,
        website: "javascript:alert(1)",
      }),
      formToken: await formToken(),
    });
    expect(invalid.status).toBe(422);
    const envelope = (await invalid.json()) as {
      error: { code: string; fields: Record<string, string> };
    };
    expect(envelope.error.code).toBe("validation_failed");
    expect(Object.keys(envelope.error.fields)).toEqual(
      expect.arrayContaining(["email", "message", "consent", "website"]),
    );
  });

  it("limits enquiries per email address", async () => {
    const email = uniqueEmail("keen");
    for (let i = 0; i < 3; i++) {
      expect(
        (await submit({ fields: fields({ email }), formToken: await formToken() })).status,
      ).toBe(201);
    }
    const fourth = await submit({ fields: fields({ email }), formToken: await formToken() });
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get("Retry-After")).toBe("900");
  });

  it("rate-limits submissions per IP with the Workers binding", async () => {
    // RL_FORMS: 6 per 60 s (wall-clock windows) → first refusal after ≥ 6 and within 13 requests.
    const ip = uniqueIp();
    let firstLimited = -1;
    for (let i = 0; i < 13 && firstLimited < 0; i++) {
      const res = await submit({ fields: {}, formToken: "x" }, { ip });
      if (res.status === 429) firstLimited = i;
    }
    expect(firstLimited).toBeGreaterThanOrEqual(6);
    expect(firstLimited).toBeLessThanOrEqual(12);
  });

  it("scores obvious spam for triage and skips the auto-reply", async () => {
    const f = fields({
      message:
        "Best casino backlinks http://a.example http://b.example http://c.example — cheap SEO services!!!!!!!!!!",
    });
    const res = await submit({ fields: f, formToken: await formToken() });
    const { reference } = (await res.json()) as { reference: string };
    const row = await enquiryByReference(reference);
    expect(row?.spamScore).toBeGreaterThanOrEqual(50);
    expect(sentTo(f.email)).toHaveLength(0);
    expect(sentTo(TEAM).some((m) => m.subject.includes(reference))).toBe(true);
  });
});

describe("Turnstile (server-side verification)", () => {
  afterEach(() => vi.restoreAllMocks());
  const withSecret = {
    ...testEnv,
    TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-looking-secret",
  } as WorkerEnv;

  function siteverify(result: Record<string, unknown>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
        throw new Error(`unexpected fetch ${url}`);
      }
      return Response.json(result);
    });
  }

  it("rejects a failed or foreign-host token and accepts a valid one", async () => {
    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    const failed = await submit(
      { fields: fields(), formToken: await formToken(), turnstileToken: "tok" },
      { env: withSecret },
    );
    expect(failed.status).toBe(422);
    vi.restoreAllMocks();

    siteverify({ success: true, hostname: "evil.example", action: "enquiry" });
    const foreign = await submit(
      { fields: fields(), formToken: await formToken(), turnstileToken: "tok" },
      { env: withSecret },
    );
    expect(foreign.status).toBe(422);
    vi.restoreAllMocks();

    const spy = siteverify({ success: true, hostname: "localhost", action: "enquiry" });
    const f = fields();
    const ok = await submit(
      { fields: f, formToken: await formToken(), turnstileToken: "tok" },
      { env: withSecret },
    );
    expect(ok.status).toBe(201);
    const init = spy.mock.calls[0]?.[1];
    const form = init?.body as FormData;
    expect(form.get("secret")).toBe("0x4AAAAAAA-real-looking-secret");
    expect(form.get("response")).toBe("tok");
    expect(form.get("remoteip")).toMatch(/^198\.18\./);
    const { reference } = (await ok.json()) as { reference: string };
    expect((await enquiryByReference(reference))?.turnstileOk).toBe(true);
  });

  it("requires a token when a secret is configured", async () => {
    const spy = siteverify({ success: true });
    const res = await submit(
      { fields: fields(), formToken: await formToken() },
      { env: withSecret },
    );
    expect(res.status).toBe(422);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("enquiry administration", () => {
  async function newEnquiry() {
    const res = await submit({ fields: fields(), formToken: await formToken() });
    const { reference } = (await res.json()) as { reference: string };
    const row = await enquiryByReference(reference);
    if (!row) throw new Error("enquiry missing");
    return row;
  }

  it("moves enquiries only along allowed transitions, with events and audit", async () => {
    const enquiry = await newEnquiry();
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    const clock = manualClock(Date.now() + 1000); // distinct timestamps → deterministic ordering
    await changeEnquiryStatus(
      makeCtx({ clock }),
      staff,
      enquiry.id,
      "contacted",
      "Called, sending proposal",
    );
    clock.advance(1000);
    let row = await enquiryByReference(enquiry.reference);
    expect(row?.status).toBe("contacted");
    expect(row?.firstResponseAt).not.toBeNull();
    expect(row?.closedAt).toBeNull();

    await changeEnquiryStatus(makeCtx({ clock }), staff, enquiry.id, "won");
    row = await enquiryByReference(enquiry.reference);
    expect(row?.closedAt).not.toBeNull();

    const conflict = await appError(changeEnquiryStatus(makeCtx(), staff, enquiry.id, "contacted"));
    expect(conflict.code).toBe("conflict");
    const detail = await getEnquiry(makeCtx(), staff, enquiry.id);
    expect(detail.events.map((e) => `${e.type}:${e.toStatus}`)).toEqual([
      "status_change:won",
      "status_change:contacted",
      "received:received",
    ]);
    expect(detail.events[1]?.body).toBe("Called, sending proposal");
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, enquiry.id))
      .all();
    expect(audit).toHaveLength(2);
  });

  it("keeps enquiries private to enquiry permissions", async () => {
    const enquiry = await newEnquiry();
    for (const role of ["member", "client"]) {
      const actor = await actorFor((await createUser({ roles: [role] })).id);
      expect((await appError(listEnquiries(makeCtx(), actor))).code, role).toBe("forbidden");
      expect((await appError(getEnquiry(makeCtx(), actor, enquiry.id))).code, role).toBe(
        "forbidden",
      );
      expect(
        (await appError(changeEnquiryStatus(makeCtx(), actor, enquiry.id, "processing"))).code,
      ).toBe("forbidden");
    }
    expect((await appError(listEnquiries(makeCtx(), null))).code).toBe("unauthenticated");
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    expect(
      (await appError(getEnquiry(makeCtx(), staff, "enq_01J8Z6XG0000000000000000ZZ"))).code,
    ).toBe("not_found");
    expect((await appError(getEnquiry(makeCtx(), staff, "../../etc/passwd"))).code).toBe(
      "not_found",
    );
  });

  it("validates notes and paginates the inbox", async () => {
    const enquiry = await newEnquiry();
    await newEnquiry();
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id);
    expect((await appError(addEnquiryNote(makeCtx(), manager, enquiry.id, "   "))).code).toBe(
      "validation_failed",
    );
    expect(
      (await appError(addEnquiryNote(makeCtx(), manager, enquiry.id, "x".repeat(2001)))).code,
    ).toBe("validation_failed");
    await addEnquiryNote(makeCtx(), manager, enquiry.id, "Budget confirmed on call.");
    const page1 = await listEnquiries(makeCtx(), manager, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextBefore).not.toBeNull();
    const page2 = await listEnquiries(makeCtx(), manager, {
      limit: 1,
      before: page1.nextBefore ?? 0,
    });
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    const received = await listEnquiries(makeCtx(), manager, { status: "received", limit: 100 });
    expect(received.items.every((i) => i.status === "received")).toBe(true);
  });
});
