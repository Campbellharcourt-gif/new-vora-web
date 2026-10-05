import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { elevate } from "~/.server/auth/account";
import { signIn } from "~/.server/auth/login";
import { AppError } from "~/.server/lib/errors";
import {
  listNotifications,
  markNotificationsRead,
  notify,
  unreadNotificationCount,
} from "~/.server/services/notifications";
import {
  cancelAccountDeletion,
  exportAccountData,
  handlePrivacyRequest,
  listPrivacyRequests,
  requestAccountDeletion,
} from "~/.server/services/privacy";
import {
  actorFor,
  createUser,
  db,
  disableBreachCheck,
  makeCtx,
  PASSWORD,
  schema,
  sentTo,
  signedInSession,
  uniqueIp,
} from "../support/helpers";

async function code(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!error) return "ok";
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

async function elevated(userId: string) {
  await elevate(makeCtx(), await actorFor(userId), PASSWORD);
  return actorFor(userId, { elevated: true });
}

beforeAll(async () => {
  await disableBreachCheck();
});

describe("privacy — download your data", () => {
  it("needs a password confirmation and contains only the person's own data", async () => {
    const user = await createUser({ roles: ["client"], name: "Pat Export" });
    const other = await createUser({ roles: ["client"], name: "Someone Else" });
    await notify(makeCtx(), user.id, { type: "test", title: "Mine" });
    await notify(makeCtx(), other.id, { type: "test", title: "Not mine" });
    expect(await code(exportAccountData(makeCtx(), await actorFor(user.id)))).toBe(
      "validation_failed",
    );
    const data = await exportAccountData(makeCtx(), await elevated(user.id));
    expect(data.account).toMatchObject({ name: "Pat Export", email: user.email });
    expect(data.notifications.map((n) => n.title)).toEqual(["Mine"]);
    const text = JSON.stringify(data);
    expect(text).not.toContain("Not mine");
    expect(text).not.toMatch(/argon2|passwordHash|tokenHash|ipHash|codeHmac/);
    const requests = await db
      .select()
      .from(schema.privacyRequests)
      .where(eq(schema.privacyRequests.userId, user.id))
      .all();
    expect(requests.map((r) => `${r.type}:${r.status}`)).toEqual(["export:completed"]);
  });
});

describe("privacy — account deletion", () => {
  it("is requested with confirmation, handled by privacy managers, and anonymises the account", async () => {
    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const member = await createUser({ roles: ["member"], name: "Dana Leaving" });
    const actor = await elevated(member.id);
    expect(
      await code(requestAccountDeletion(makeCtx(), actor, { confirmEmail: "wrong@example.test" })),
    ).toBe("validation_failed");
    await requestAccountDeletion(makeCtx(), actor, { confirmEmail: member.email });
    expect(
      await code(requestAccountDeletion(makeCtx(), actor, { confirmEmail: member.email })),
    ).toBe("conflict");
    expect(sentTo(member.email).map((m) => m.subject)).toContain(
      "Security notice: We received your deletion request",
    );
    const notes = await listNotifications(makeCtx(), admin);
    expect(notes.some((n) => n.type === "privacy.request" && n.link === "/admin/privacy")).toBe(
      true,
    );

    // Members and clients can't see the queue.
    expect(await code(listPrivacyRequests(makeCtx(), actor))).toBe("forbidden");

    const [request] = await listPrivacyRequests(makeCtx(), admin, { open: true }).then((rows) =>
      rows.filter((r) => r.userId === member.id),
    );
    const session = await signedInSession(member.id);
    await handlePrivacyRequest(makeCtx(), admin, request?.id ?? "", { action: "complete" });

    const row = await db.select().from(schema.users).where(eq(schema.users.id, member.id)).get();
    expect(row).toMatchObject({ name: "Deleted user", status: "deactivated", passwordHash: null });
    expect(row?.email).not.toBe(member.email);
    expect(row?.deletedAt).not.toBeNull();
    const roles = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, member.id))
      .all();
    expect(roles).toEqual([]);
    const live = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.sessionId))
      .get();
    expect(live?.revokedAt).not.toBeNull();
    const result = await signIn(makeCtx({ ip: uniqueIp() }), {
      email: member.email,
      password: PASSWORD,
    });
    expect(result.kind).not.toBe("signed_in");
    expect(sentTo(member.email).map((m) => m.subject)).toContain(
      "Security notice: Your VORA account has been deleted",
    );
    // The audit trail of the deletion remains.
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "privacy.delete.complete"))
      .all();
    expect(audit).toHaveLength(1);
  });

  it("can be cancelled while pending; the last Owner and higher-ranked accounts are protected", async () => {
    const client = await createUser({ roles: ["client"] });
    const actor = await elevated(client.id);
    await requestAccountDeletion(makeCtx(), actor, { confirmEmail: client.email });
    await cancelAccountDeletion(makeCtx(), actor);
    expect(await code(cancelAccountDeletion(makeCtx(), actor))).toBe("conflict");

    const admin = await actorFor((await createUser({ roles: ["admin"] })).id);
    const owner = await createUser({ roles: ["owner"] });
    await requestAccountDeletion(makeCtx(), await elevated(owner.id), {
      confirmEmail: owner.email,
    });
    const [request] = (await listPrivacyRequests(makeCtx(), admin, { open: true })).filter(
      (r) => r.userId === owner.id,
    );
    // An Admin can't delete an Owner's account.
    expect(
      await code(handlePrivacyRequest(makeCtx(), admin, request?.id ?? "", { action: "complete" })),
    ).toBe("forbidden");
    const ctx = makeCtx();
    await handlePrivacyRequest(ctx, admin, request?.id ?? "", {
      action: "reject",
      note: "Please transfer ownership first.",
    });
    await ctx.flush();
    expect(
      sentTo(owner.email).some((m) => m.text.includes("Please transfer ownership first.")),
    ).toBe(true);
  });
});

describe("notifications", () => {
  it("are private to their recipient and can be marked read", async () => {
    const a = await createUser({ roles: ["member"] });
    const b = await createUser({ roles: ["member"] });
    await notify(makeCtx(), a.id, { type: "t", title: "For A", link: "https://evil.example/" });
    await notify(makeCtx(), b.id, { type: "t", title: "For B", link: "/account" });
    const actorA = await actorFor(a.id);
    const actorB = await actorFor(b.id);
    const listA = await listNotifications(makeCtx(), actorA);
    expect(listA.map((n) => n.title)).toEqual(["For A"]);
    expect(listA[0]?.link).toBeNull(); // off-site links are dropped
    const forB = (await listNotifications(makeCtx(), actorB))[0];
    // A can't mark B's notification read.
    await markNotificationsRead(makeCtx(), actorA, [forB?.id ?? ""]);
    expect(await unreadNotificationCount(makeCtx(), actorB)).toBe(1);
    await markNotificationsRead(makeCtx(), actorB, "all");
    expect(await unreadNotificationCount(makeCtx(), actorB)).toBe(0);
  });
});
