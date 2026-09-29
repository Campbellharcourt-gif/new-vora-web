import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  homePathFor,
  resendSignInCode,
  signIn,
  verifySignInCode,
  verifySignInRecoveryCode,
} from "~/.server/auth/login";
import { generateRecoveryCodes } from "~/.server/auth/mfa";
import { resolveSession } from "~/.server/auth/sessions";
import type { PendingSession } from "~/.server/auth/types";
import { sha256Hex } from "~/.server/lib/crypto";
import {
  call,
  codeFrom,
  createUser,
  db,
  mailboxFor,
  makeCtx,
  manualClock,
  PASSWORD,
  schema,
  sentTo,
  uniqueEmail,
  uniqueIp,
  withCookie,
} from "../support/helpers";

const MINUTE = 60_000;

async function pendingFrom(token: string): Promise<PendingSession> {
  const resolved = await resolveSession(makeCtx(), withCookie(token));
  if (resolved.kind !== "pending") throw new Error(`expected pending, got ${resolved.kind}`);
  return resolved.pending;
}

async function renderedAs(token: string) {
  const html = await (await call("/", { token })).text();
  return {
    actor: /data-actor="([^"]*)"/.exec(html)?.[1] ?? "",
    pending: /data-pending="([^"]*)"/.exec(html)?.[1] ?? "",
  };
}

async function securityEvents(type: string, userId?: string) {
  const rows = await db
    .select()
    .from(schema.securityEvents)
    .where(eq(schema.securityEvents.type, type))
    .all();
  return userId ? rows.filter((r) => r.userId === userId) : rows;
}

describe("password sign-in", () => {
  it("signs a member straight in with a hashed, HttpOnly session and no raw PII in the trail", async () => {
    const ip = uniqueIp();
    const user = await createUser({ roles: ["member"] });
    const result = await signIn(makeCtx({ ip }), {
      email: ` ${user.email.toUpperCase()} `,
      password: PASSWORD,
    });
    expect(result.kind).toBe("signed_in");
    if (result.kind !== "signed_in") return;
    expect(result.session.cookie).toMatch(
      /^vora_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/,
    );
    const row = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, result.session.sessionId))
      .get();
    expect(row?.id).toBe(await sha256Hex(result.session.token));
    expect(row?.authLevel).toBe("full");
    const attempts = await db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.userId, user.id))
      .all();
    expect(attempts.map((a) => a.outcome)).toEqual(["success"]);
    const trail = JSON.stringify([row, attempts]);
    expect(trail).not.toContain(user.email);
    expect(trail).not.toContain(`"${ip}"`);
    expect(await homePathFor(makeCtx(), user.id)).toBe("/member");
  });

  it("answers a wrong password and an unknown email identically", async () => {
    const user = await createUser({ roles: ["member"] });
    const wrong = await signIn(makeCtx({ ip: uniqueIp() }), {
      email: user.email,
      password: "not-the-password-1",
    });
    const unknown = await signIn(makeCtx({ ip: uniqueIp() }), {
      email: uniqueEmail("nobody"),
      password: "not-the-password-1",
    });
    expect(wrong).toEqual({ kind: "error", code: "invalid_credentials" });
    expect(unknown).toEqual(wrong);
  });

  it("asks for a challenge after 5 failures, locks after 10 and emails the account holder", async () => {
    const ip = uniqueIp();
    const clock = manualClock();
    const user = await createUser({ roles: ["member"] });
    const outcomes: string[] = [];
    let lockCtx = makeCtx({ ip, clock });
    for (let i = 0; i < 10; i++) {
      lockCtx = makeCtx({ ip, clock });
      const r = await signIn(lockCtx, { email: user.email, password: `wrong-password-${i}` });
      outcomes.push(
        r.kind === "error" ? `${r.code}${r.challengeRequired ? "+challenge" : ""}` : r.kind,
      );
    }
    await lockCtx.flush();
    expect(outcomes).toEqual([
      ...Array(4).fill("invalid_credentials"),
      ...Array(5).fill("invalid_credentials+challenge"),
      "locked",
    ]);
    // Even the right password is refused while locked.
    expect(await signIn(makeCtx({ ip, clock }), { email: user.email, password: PASSWORD })).toEqual(
      {
        kind: "error",
        code: "locked",
      },
    );
    const locked = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    expect(locked?.lockedUntil).toBeGreaterThan(clock.now());
    expect(await securityEvents("auth.login.locked", user.id)).toHaveLength(1);
    expect(sentTo(user.email).map((m) => m.subject)).toContain(
      "Security notice: Sign-in temporarily locked",
    );

    // After the lock window the account works again and the lock is cleared.
    clock.advance(16 * MINUTE);
    const after = await signIn(makeCtx({ ip, clock }), { email: user.email, password: PASSWORD });
    expect(after.kind).toBe("signed_in");
    const cleared = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    expect(cleared?.lockedUntil).toBeNull();
  });

  it("locks unknown emails on the same attempt as real ones (no enumeration)", async () => {
    const ip = uniqueIp();
    const email = uniqueEmail("ghost");
    let last: unknown;
    for (let i = 0; i < 10; i++) {
      last = await signIn(makeCtx({ ip }), { email, password: `wrong-password-${i}` });
    }
    expect(last).toEqual({ kind: "error", code: "locked" });
  });

  it("refuses suspended accounts without revealing them to password guessers", async () => {
    const user = await createUser({ roles: ["member"], status: "suspended" });
    expect(
      await signIn(makeCtx({ ip: uniqueIp() }), {
        email: user.email,
        password: "wrong-password-x",
      }),
    ).toEqual({
      kind: "error",
      code: "invalid_credentials",
    });
    expect(
      await signIn(makeCtx({ ip: uniqueIp() }), { email: user.email, password: PASSWORD }),
    ).toEqual({
      kind: "error",
      code: "account_unavailable",
    });
  });

  it("blocks an IP hash that fails against many different accounts (credential stuffing)", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 8; i++) {
      await signIn(makeCtx({ ip }), { email: uniqueEmail("stuffed"), password: "hunter2-hunter2" });
    }
    const victim = await createUser({ roles: ["member"] });
    expect(await signIn(makeCtx({ ip }), { email: victim.email, password: PASSWORD })).toEqual({
      kind: "error",
      code: "rate_limited",
    });
    expect((await securityEvents("auth.ip.blocked")).length).toBeGreaterThan(0);
    const elsewhere = await signIn(makeCtx({ ip: uniqueIp() }), {
      email: victim.email,
      password: PASSWORD,
    });
    expect(elsewhere.kind).toBe("signed_in");
  });

  it("rate-limits sign-in attempts per IP with the Workers rate-limit binding", async () => {
    // RL_AUTH allows 20 per 60 s window. Windows are wall-clock aligned, so a run may straddle
    // one boundary: the first refusal must come after ≥ 20 attempts and within 41.
    const ip = uniqueIp();
    const email = uniqueEmail("flood");
    let firstLimited = -1;
    for (let i = 0; i < 41 && firstLimited < 0; i++) {
      const r = await signIn(makeCtx({ ip }), { email, password: "wrong-password-flood" });
      if (r.kind === "error" && r.code === "rate_limited") firstLimited = i;
    }
    expect(firstLimited).toBeGreaterThanOrEqual(20);
    expect(firstLimited).toBeLessThanOrEqual(40);
    expect((await securityEvents("rate_limit.exceeded")).length).toBeGreaterThan(0);
  });
});

describe("two-step sign-in (email code)", () => {
  it("requires an emailed code for privileged roles and never stores the code", async () => {
    const ip = uniqueIp();
    const staff = await createUser({ roles: ["staff"] });
    const result = await signIn(makeCtx({ ip }), { email: staff.email, password: PASSWORD });
    expect(result.kind).toBe("mfa_required");
    if (result.kind !== "mfa_required") return;
    expect(result.codeSent).toBe(true);
    expect(result.session.cookie).toContain("Max-Age=600");

    const mail = (await mailboxFor(staff.email)).at(-1);
    expect(mail?.subject).toMatch(/^\d{6} is your VORA sign-in code$/);
    const code = codeFrom(mail?.text ?? "");

    const challenge = await db
      .select()
      .from(schema.mfaChallenges)
      .where(eq(schema.mfaChallenges.userId, staff.id))
      .get();
    expect(challenge?.codeHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge?.codeHmac).not.toContain(code);
    const outbox = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.toEmail, staff.email))
      .all();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      template: "loginCode",
      subject: "Sign-in code",
      payload: { redacted: true },
      sensitive: true,
      status: "sent",
    });

    // The password-only session is "pending": it cannot act as a signed-in user.
    expect(await renderedAs(result.session.token)).toEqual({ actor: "", pending: staff.id });
    const api = await call("/api/v1/account/sessions", { token: result.session.token });
    expect(api.status).toBe(401);

    const pending = await pendingFrom(result.session.token);
    const wrongCode = code === "000000" ? "111111" : "000000";
    expect(await verifySignInCode(makeCtx({ ip }), pending, wrongCode)).toEqual({
      kind: "error",
      code: "invalid_code",
      attemptsRemaining: 4,
    });

    const done = await verifySignInCode(makeCtx({ ip }), pending, code);
    expect(done.kind).toBe("signed_in");
    if (done.kind !== "signed_in") return;
    const full = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, done.session.sessionId))
      .get();
    expect(full).toMatchObject({ authLevel: "full", authMethod: "password+email_otp" });
    expect(full?.mfaVerifiedAt).not.toBeNull();
    expect(done.session.cookie).toContain("Max-Age=43200"); // privileged: 12 h absolute
    const old = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, result.session.sessionId))
      .get();
    expect(old?.revokedReason).toBe("mfa_completed");

    // New token: the old pending token is dead; the new one is a full actor.
    expect(done.session.token).not.toBe(result.session.token);
    expect(await renderedAs(result.session.token)).toEqual({ actor: "", pending: "" });
    expect(await renderedAs(done.session.token)).toEqual({ actor: staff.id, pending: "" });
    expect(await homePathFor(makeCtx(), staff.id)).toBe("/admin");

    // The code cannot be replayed.
    expect((await verifySignInCode(makeCtx({ ip }), pending, code)).kind).toBe("error");
  });

  it("burns the challenge and the pending session after five wrong codes", async () => {
    const ip = uniqueIp();
    const admin = await createUser({ roles: ["admin"] });
    const result = await signIn(makeCtx({ ip }), { email: admin.email, password: PASSWORD });
    if (result.kind !== "mfa_required") throw new Error(result.kind);
    const code = codeFrom((await mailboxFor(admin.email)).at(-1)?.text ?? "");
    const pending = await pendingFrom(result.session.token);
    const wrong = code === "000000" ? "111111" : "000000";
    const outcomes = [];
    for (let i = 0; i < 5; i++)
      outcomes.push(await verifySignInCode(makeCtx({ ip }), pending, wrong));
    expect(
      outcomes.map((o) => (o.kind === "error" ? (o.attemptsRemaining ?? o.code) : o.kind)),
    ).toEqual([4, 3, 2, 1, "too_many_attempts"]);
    const session = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, result.session.sessionId))
      .get();
    expect(session?.revokedReason).toBe("mfa_attempts_exhausted");
    expect((await verifySignInCode(makeCtx({ ip }), pending, code)).kind).toBe("error");
    expect(await securityEvents("auth.mfa.failed_limit", admin.id)).toHaveLength(1);
  });

  it("enforces the resend cooldown", async () => {
    const ip = uniqueIp();
    const manager = await createUser({ roles: ["manager"] });
    const result = await signIn(makeCtx({ ip }), { email: manager.email, password: PASSWORD });
    if (result.kind !== "mfa_required") throw new Error(result.kind);
    const pending = await pendingFrom(result.session.token);
    const resend = await resendSignInCode(makeCtx({ ip }), pending);
    expect(resend).toMatchObject({ ok: false, reason: "cooldown" });
    expect(sentTo(manager.email)).toHaveLength(1);
  });

  it("accepts each recovery code once, in any format, and alerts the account holder", async () => {
    const ip = uniqueIp();
    const staff = await createUser({ roles: ["staff"] });
    const codes = await generateRecoveryCodes(makeCtx(), staff.id);
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const stored = await db
      .select()
      .from(schema.recoveryCodes)
      .where(eq(schema.recoveryCodes.userId, staff.id))
      .all();
    expect(stored).toHaveLength(10);
    expect(JSON.stringify(stored)).not.toContain((codes[0] ?? "").replace("-", ""));

    const first = await signIn(makeCtx({ ip }), { email: staff.email, password: PASSWORD });
    if (first.kind !== "mfa_required") throw new Error(first.kind);
    const ctx = makeCtx({ ip });
    const done = await verifySignInRecoveryCode(
      ctx,
      await pendingFrom(first.session.token),
      ` ${(codes[0] ?? "").toLowerCase()} `,
    );
    await ctx.flush();
    expect(done.kind).toBe("signed_in");
    if (done.kind === "signed_in") {
      const s = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, done.session.sessionId))
        .get();
      expect(s?.authMethod).toBe("password+recovery_code");
    }
    expect(sentTo(staff.email).map((m) => m.subject)).toContain(
      "Security notice: A recovery code was used",
    );
    expect(await securityEvents("auth.recovery_code.used", staff.id)).toHaveLength(1);

    const second = await signIn(makeCtx({ ip }), { email: staff.email, password: PASSWORD });
    if (second.kind !== "mfa_required") throw new Error(second.kind);
    expect(
      await verifySignInRecoveryCode(
        makeCtx({ ip }),
        await pendingFrom(second.session.token),
        codes[0] ?? "",
      ),
    ).toEqual({ kind: "error", code: "invalid_recovery_code" });
    const unused = await db
      .select()
      .from(schema.recoveryCodes)
      .where(and(eq(schema.recoveryCodes.userId, staff.id)))
      .all();
    expect(unused.filter((r) => r.usedAt === null)).toHaveLength(9);
  });

  it("asks non-privileged users for a code on a risky sign-in and alerts on new devices", async () => {
    const member = await createUser({ roles: ["member"] });
    const home = await signIn(makeCtx({ ip: uniqueIp(), country: "AU" }), {
      email: member.email,
      password: PASSWORD,
    });
    expect(home.kind).toBe("signed_in");

    const ip = uniqueIp();
    const awayUa =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
    const away = await signIn(makeCtx({ ip, country: "US", userAgent: awayUa }), {
      email: member.email,
      password: PASSWORD,
    });
    expect(away.kind).toBe("mfa_required");
    if (away.kind !== "mfa_required") return;
    const suspicious = await securityEvents("auth.login.suspicious", member.id);
    expect(suspicious).toHaveLength(1);
    expect(suspicious[0]?.details).toMatchObject({
      reasons: expect.arrayContaining(["new_device", "new_country", "rapid_country_change"]),
    });

    const code = codeFrom((await mailboxFor(member.email)).at(-1)?.text ?? "");
    const ctx = makeCtx({ ip, country: "US", userAgent: awayUa });
    const done = await verifySignInCode(ctx, await pendingFrom(away.session.token), code);
    await ctx.flush();
    expect(done.kind).toBe("signed_in");
    const alert = sentTo(member.email).find(
      (m) => m.subject === "New sign-in to your VORA account",
    );
    expect(alert?.text).toContain("Chrome on Windows");
    expect(alert?.text).toContain("US");
  });
});

describe("session validation on every request", () => {
  async function freshSession(roles: string[]) {
    const user = await createUser({ roles });
    const result = await signIn(makeCtx({ ip: uniqueIp() }), {
      email: user.email,
      password: PASSWORD,
    });
    if (result.kind !== "signed_in") throw new Error(result.kind);
    return { user, token: result.session.token, sessionId: result.session.sessionId };
  }

  it("resolves a valid session and rejects forged or malformed tokens", async () => {
    const { user, token } = await freshSession(["member"]);
    expect(await renderedAs(token)).toEqual({ actor: user.id, pending: "" });
    expect(await renderedAs("A".repeat(43))).toEqual({ actor: "", pending: "" });
    const malformed = await (
      await call("/", { headers: { cookie: "vora_session=../../etc" } })
    ).text();
    expect(malformed).toContain('data-actor=""');
  });

  it("stops honouring revoked, idle-expired and absolutely expired sessions", async () => {
    const past = Date.now() - 1000;
    for (const change of [
      { revokedAt: past },
      { idleExpiresAt: past },
      { expiresAt: past, createdAt: past - 1000 },
    ]) {
      const { token, sessionId } = await freshSession(["member"]);
      await db.update(schema.sessions).set(change).where(eq(schema.sessions.id, sessionId));
      expect(await renderedAs(token), JSON.stringify(change)).toEqual({ actor: "", pending: "" });
    }
  });

  it("drops sessions of suspended users immediately", async () => {
    const { user, token } = await freshSession(["member"]);
    await db.update(schema.users).set({ status: "suspended" }).where(eq(schema.users.id, user.id));
    expect(await renderedAs(token)).toEqual({ actor: "", pending: "" });
  });

  it("requires 2FA again when a user gains a privileged role mid-session", async () => {
    const { user, token } = await freshSession(["member"]);
    const staffRole = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.key, "staff"))
      .get();
    await db
      .insert(schema.userRoles)
      .values({ userId: user.id, roleId: staffRole?.id ?? "", grantedAt: Date.now() });
    expect(await renderedAs(token)).toEqual({ actor: "", pending: "" });
  });

  it("refreshes last-seen at most every five minutes", async () => {
    const { token, sessionId } = await freshSession(["member"]);
    const stale = Date.now() - 6 * MINUTE;
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: stale })
      .where(eq(schema.sessions.id, sessionId));
    await call("/", { token });
    const touched = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get();
    expect(touched?.lastSeenAt).toBeGreaterThan(stale);
  });
});
