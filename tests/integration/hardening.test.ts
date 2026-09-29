import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { requestPasswordResetInBackground } from "~/.server/auth/password-reset";
import { type EmailTransport, setEmailTransportOverride } from "~/.server/email/transport";
import {
  actorFor,
  call,
  createUser,
  db,
  makeCtx,
  putSetting,
  SAME_ORIGIN,
  schema,
  uniqueEmail,
  uniqueIp,
} from "../support/helpers";

/**
 * Defects found by the security verification of the production build (docs/VERIFICATION-LOG.md,
 * CP-2): single-fetch data URLs (`<page>.data`) escaping path policy, and a timing oracle on the
 * password-reset form.
 */
describe("single-fetch data URLs", () => {
  it("are private and uncacheable in private areas, like their pages", async () => {
    const member = await actorFor((await createUser({ roles: ["member"] })).id);
    for (const path of ["/account.data", "/member.data"]) {
      const res = await call(path, { token: member.token });
      expect(res.headers.get("Cache-Control"), path).toBe("private, no-store");
      expect(res.headers.get("X-Robots-Tag"), path).toBe("noindex, nofollow");
    }
  });

  it("keep sign-in working during maintenance while other data stays behind the gate", async () => {
    await putSetting("maintenance", { enabled: true, message: null });
    try {
      const signIn = await call("/login.data", {
        method: "POST",
        headers: { ...SAME_ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        body: "email=a%40example.test&password=x",
      });
      expect(signIn.status).not.toBe(503);
      expect((await call("/login/verify.data")).status).not.toBe(503);
      expect((await call("/contact.data")).status).toBe(503);
      expect((await call("/_.data")).status).toBe(503);
    } finally {
      await putSetting("maintenance", { enabled: false, message: null });
    }
  });
});

describe("password reset requests (no timing oracle)", () => {
  afterEach(() => setEmailTransportOverride(null));

  it("return before any account-dependent work, which still completes afterwards", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    const slowTransport: EmailTransport = {
      name: "resend",
      async send(message) {
        await gate; // stands in for the email provider's round trip
        sent.push(message.to);
        return { id: "re_slow" };
      },
    };
    setEmailTransportOverride(slowTransport);
    const user = await createUser({ roles: ["member"] });

    const ctx = makeCtx({ ip: uniqueIp() });
    expect(requestPasswordResetInBackground(ctx, user.email)).toBeUndefined(); // nothing to await
    const unknownCtx = makeCtx({ ip: uniqueIp() });
    expect(requestPasswordResetInBackground(unknownCtx, uniqueEmail("nobody"))).toBeUndefined();
    expect(sent).toEqual([]);

    release();
    await ctx.flush();
    await unknownCtx.flush();
    expect(sent).toEqual([user.email]);
    const tokens = await db
      .select()
      .from(schema.authTokens)
      .where(eq(schema.authTokens.userId, user.id))
      .all();
    expect(tokens).toHaveLength(1);
  });
});
