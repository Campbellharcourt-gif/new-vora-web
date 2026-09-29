import { describe, expect, it, vi } from "vitest";
import { backoffFor, MAX_ATTEMPTS } from "~/.server/email/outbox";
import { esc, templates } from "~/.server/email/templates";
import { EmailSendError, ResendTransport } from "~/.server/email/transport";

const t = { appName: "VORA", origin: "https://vorawebsites.store" };

describe("email templates", () => {
  it("escapes every user-controlled value in HTML", () => {
    const hostile = '<script>alert("x")</script>';
    const mail = templates.enquiryNotification(t, {
      reference: "VR-ABC123",
      name: hostile,
      email: "a@b.co",
      company: '"><img src=x onerror=alert(1)>',
      website: "https://example.com",
      projectTypes: "Branding",
      timeline: "Flexible",
      message: `Hello\n${hostile}`,
      adminUrl: "https://vorawebsites.store/admin/enquiries/enq_x",
      spamScore: 0,
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.text).toContain(hostile); // plain text is not HTML; it is shown verbatim
    expect(mail.subject).toContain("VR-ABC123");
  });

  it("puts the one-time code in the body and subject, and states expiry", () => {
    const mail = templates.loginCode(t, { name: "Strive", code: "042317", minutes: 10 });
    expect(mail.subject).toBe("042317 is your VORA sign-in code");
    expect(mail.text).toContain("042317");
    expect(mail.text).toContain("10 minutes");
    expect(mail.html).toContain("042317");
  });

  it("escapes attribute context in action links", () => {
    const mail = templates.passwordReset(t, {
      name: "A",
      url: 'https://vorawebsites.store/reset-password/abc" onclick="x',
      minutes: 30,
    });
    expect(mail.html).not.toContain('" onclick="');
    expect(mail.html).toContain("&quot; onclick=&quot;");
  });

  it("never states claims the business has not made (confirmation copy)", () => {
    const mail = templates.enquiryConfirmation(t, {
      name: "Jordan",
      reference: "VR-XYZ789",
      replyEmail: "projects@vorawebsites.store",
    });
    expect(mail.text).toContain("VR-XYZ789");
    expect(mail.text).not.toMatch(/within \d+ (hours|days)|guarantee/i);
  });

  it("esc covers the five HTML-significant characters", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(esc(null)).toBe("");
  });
});

describe("outbox retry policy", () => {
  it("backs off 1, 5, 15, 60, 360 minutes and caps", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((a) => backoffFor(a) / 60_000)).toEqual([
      1, 5, 15, 60, 360, 360, 360,
    ]);
    expect(MAX_ATTEMPTS).toBe(6);
  });
});

describe("Resend transport (fake fetch)", () => {
  const message = {
    to: "client@example.com",
    subject: "Hi",
    html: "<p>Hi</p>",
    text: "Hi",
    replyTo: "projects@vorawebsites.store",
    idempotencyKey: "enquiry:enq_1:team",
  };

  it("posts the documented payload with bearer auth and an idempotency key", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ id: "re_123" }),
    );
    const transport = new ResendTransport(
      "re_key",
      "VORA <hello@vorawebsites.store>",
      fetchImpl as never,
    );
    expect(await transport.send(message)).toEqual({ id: "re_123" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_key");
    expect(headers["Idempotency-Key"]).toBe("enquiry:enq_1:team");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "VORA <hello@vorawebsites.store>",
      to: ["client@example.com"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      reply_to: "projects@vorawebsites.store",
    });
  });

  it("marks 429/5xx and network failures retryable, 4xx permanent", async () => {
    const send = (impl: () => Promise<Response>) =>
      new ResendTransport("k", "f", impl as never).send(message).catch((e: unknown) => e);
    const rateLimited = (await send(async () =>
      Response.json({ name: "rate_limit_exceeded" }, { status: 429 }),
    )) as EmailSendError;
    expect(rateLimited).toBeInstanceOf(EmailSendError);
    expect(rateLimited.retryable).toBe(true);
    const serverError = (await send(
      async () => new Response("oops", { status: 502 }),
    )) as EmailSendError;
    expect(serverError.retryable).toBe(true);
    const invalid = (await send(async () =>
      Response.json({ name: "validation_error" }, { status: 422 }),
    )) as EmailSendError;
    expect(invalid.retryable).toBe(false);
    expect(invalid.providerStatus).toBe(422);
    const network = (await send(async () => {
      throw new TypeError("fetch failed");
    })) as EmailSendError;
    expect(network.retryable).toBe(true);
    const noId = (await send(async () => Response.json({}))) as EmailSendError;
    expect(noId).toBeInstanceOf(EmailSendError);
  });

  it("does not put the API key in error messages", async () => {
    const error = (await new ResendTransport("re_SUPERSECRET", "f", (async () =>
      Response.json(
        { name: "invalid_api_key", message: "API key re_SUPERSECRET is invalid" },
        { status: 401 },
      )) as never)
      .send(message)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("re_SUPERSECRET");
  });
});
