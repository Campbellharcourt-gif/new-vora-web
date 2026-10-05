import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { sendSecurityNotice } from "../auth/alerts";
import { activeOwnerExists } from "../auth/bootstrap";
import { authorize, canManageUser, loadUserAccess } from "../auth/rbac";
import { revokeUserSessions } from "../auth/sessions";
import { type Actor, isElevated } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";
import { notifyPermissionHolders } from "./notifications";

/**
 * Account privacy controls: see what VORA holds, download it, and ask for the account to be
 * deleted. Exports are generated on request for the signed-in person only (after a password
 * confirmation) and never stored. Deletion requests go to people with privacy.manage, who
 * complete them by anonymising the account; the audit trail (which never holds secrets) is kept.
 */

function requireElevated(ctx: ServerContext, actor: Actor) {
  if (!isElevated(actor, ctx.clock.now())) {
    throw errors.validation(
      { _form: "Confirm your password to continue." },
      "Confirm your password to continue.",
    );
  }
}

async function self(ctx: ServerContext, actor: Actor) {
  const user = await ctx.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, actor.userId), isNull(schema.users.deletedAt)))
    .get();
  if (!user) throw errors.unauthenticated();
  return user;
}

export async function privacyOverview(ctx: ServerContext, actorInput: Actor | null) {
  if (!actorInput) throw errors.unauthenticated();
  const user = await self(ctx, actorInput);
  const requests = await ctx.db
    .select({
      id: schema.privacyRequests.id,
      type: schema.privacyRequests.type,
      status: schema.privacyRequests.status,
      requestedAt: schema.privacyRequests.requestedAt,
      completedAt: schema.privacyRequests.completedAt,
    })
    .from(schema.privacyRequests)
    .where(eq(schema.privacyRequests.userId, actorInput.userId))
    .orderBy(desc(schema.privacyRequests.requestedAt))
    .limit(20)
    .all();
  return {
    user: {
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    requests,
    openDeletion: requests.find(
      (r) => r.type === "delete" && (r.status === "received" || r.status === "in_progress"),
    ),
  };
}

/** Everything VORA holds about the signed-in person, as plain data (no hashes, tokens or keys). */
export async function exportAccountData(ctx: ServerContext, actorInput: Actor | null) {
  if (!actorInput) throw errors.unauthenticated();
  requireElevated(ctx, actorInput);
  const user = await self(ctx, actorInput);
  const id = user.id;
  const [roles, orgs, enquiries, messages, notifications, logins, sessions, requests] =
    await Promise.all([
      ctx.db
        .select({ name: schema.roles.name })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
        .where(eq(schema.userRoles.userId, id))
        .all(),
      ctx.db
        .select({ organisation: schema.clientOrgs.name, role: schema.clientOrgMembers.orgRole })
        .from(schema.clientOrgMembers)
        .innerJoin(schema.clientOrgs, eq(schema.clientOrgs.id, schema.clientOrgMembers.orgId))
        .where(eq(schema.clientOrgMembers.userId, id))
        .all(),
      ctx.db
        .select({
          reference: schema.enquiries.reference,
          name: schema.enquiries.name,
          email: schema.enquiries.email,
          company: schema.enquiries.company,
          website: schema.enquiries.websiteUrl,
          projectTypes: schema.enquiries.projectTypes,
          budget: schema.enquiries.budgetLabel,
          timeline: schema.enquiries.timelineLabel,
          message: schema.enquiries.message,
          status: schema.enquiries.status,
          receivedAt: schema.enquiries.createdAt,
        })
        .from(schema.enquiries)
        .where(and(eq(schema.enquiries.email, user.email), isNull(schema.enquiries.deletedAt)))
        .all(),
      ctx.db
        .select({
          project: schema.engagements.name,
          message: schema.engagementMessages.body,
          sentAt: schema.engagementMessages.createdAt,
        })
        .from(schema.engagementMessages)
        .innerJoin(
          schema.engagements,
          eq(schema.engagements.id, schema.engagementMessages.engagementId),
        )
        .where(
          and(
            eq(schema.engagementMessages.authorId, id),
            isNull(schema.engagementMessages.deletedAt),
          ),
        )
        .all(),
      ctx.db
        .select({
          title: schema.notifications.title,
          body: schema.notifications.body,
          createdAt: schema.notifications.createdAt,
          readAt: schema.notifications.readAt,
        })
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, id))
        .all(),
      ctx.db
        .select({
          outcome: schema.loginAttempts.outcome,
          country: schema.loginAttempts.country,
          city: schema.loginAttempts.city,
          at: schema.loginAttempts.createdAt,
        })
        .from(schema.loginAttempts)
        .where(eq(schema.loginAttempts.userId, id))
        .orderBy(desc(schema.loginAttempts.createdAt))
        .limit(500)
        .all(),
      ctx.db
        .select({
          createdAt: schema.sessions.createdAt,
          lastSeenAt: schema.sessions.lastSeenAt,
          userAgent: schema.sessions.userAgent,
          country: schema.sessions.country,
          city: schema.sessions.city,
          revokedAt: schema.sessions.revokedAt,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, id))
        .all(),
      ctx.db
        .select({
          type: schema.privacyRequests.type,
          status: schema.privacyRequests.status,
          requestedAt: schema.privacyRequests.requestedAt,
          completedAt: schema.privacyRequests.completedAt,
        })
        .from(schema.privacyRequests)
        .where(eq(schema.privacyRequests.userId, id))
        .all(),
    ]);
  const now = ctx.clock.now();
  await ctx.db.insert(schema.privacyRequests).values({
    id: newId("privacyRequest", now),
    userId: id,
    email: user.email,
    type: "export",
    status: "completed",
    requestedAt: now,
    completedAt: now,
    notes: "Downloaded by the account holder",
  });
  await writeAudit(ctx, actorInput, {
    action: "privacy.export",
    targetType: "user",
    targetId: id,
    summary: "Downloaded their account data",
  });
  const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
  return {
    generatedAt: iso(now),
    account: {
      name: user.name,
      email: user.email,
      status: user.status,
      createdAt: iso(user.createdAt),
      emailConfirmedAt: iso(user.emailVerifiedAt),
      lastSignInAt: iso(user.lastLoginAt),
      twoStepByEmail: user.mfaEnforced,
      roles: roles.map((r) => r.name),
    },
    clientOrganisations: orgs,
    enquiries: enquiries.map((e) => ({ ...e, receivedAt: iso(e.receivedAt) })),
    projectMessages: messages.map((m) => ({ ...m, sentAt: iso(m.sentAt) })),
    notifications: notifications.map((n) => ({
      ...n,
      createdAt: iso(n.createdAt),
      readAt: iso(n.readAt),
    })),
    signInHistory: logins.map((l) => ({ ...l, at: iso(l.at) })),
    sessions: sessions.map((s) => ({
      ...s,
      createdAt: iso(s.createdAt),
      lastSeenAt: iso(s.lastSeenAt),
      revokedAt: iso(s.revokedAt),
    })),
    privacyRequests: requests.map((r) => ({
      ...r,
      requestedAt: iso(r.requestedAt),
      completedAt: iso(r.completedAt),
    })),
  };
}

export async function requestAccountDeletion(
  ctx: ServerContext,
  actorInput: Actor | null,
  input: { confirmEmail: string; reason?: string },
): Promise<void> {
  if (!actorInput) throw errors.unauthenticated();
  requireElevated(ctx, actorInput);
  const user = await self(ctx, actorInput);
  if (input.confirmEmail.trim().toLowerCase() !== user.email) {
    throw errors.validation({ confirmEmail: "Type your account email address to confirm." });
  }
  const open = await ctx.db
    .select({ id: schema.privacyRequests.id })
    .from(schema.privacyRequests)
    .where(
      and(
        eq(schema.privacyRequests.userId, user.id),
        eq(schema.privacyRequests.type, "delete"),
        inArray(schema.privacyRequests.status, ["received", "in_progress"]),
      ),
    )
    .get();
  if (open) throw errors.conflict("You've already asked for your account to be deleted.");
  const now = ctx.clock.now();
  const id = newId("privacyRequest", now);
  await ctx.db.insert(schema.privacyRequests).values({
    id,
    userId: user.id,
    email: user.email,
    type: "delete",
    status: "received",
    requestedAt: now,
    notes: input.reason?.trim().slice(0, 1000) || null,
  });
  await writeAudit(ctx, actorInput, {
    action: "privacy.delete.request",
    targetType: "privacy_request",
    targetId: id,
    summary: "Asked for their account to be deleted",
  });
  await notifyPermissionHolders(
    ctx,
    "privacy.manage",
    {
      type: "privacy.request",
      title: "New account deletion request",
      body: `${user.name} asked for their account to be deleted.`,
      link: "/admin/privacy",
    },
    user.id,
  );
  await sendSecurityNotice(
    ctx,
    user,
    "We received your deletion request",
    "You asked for your VORA account to be deleted. The team will handle it and let you know when it's done. If this wasn't you, sign in and cancel the request from Account › Privacy, then change your password.",
  );
}

export async function cancelAccountDeletion(ctx: ServerContext, actorInput: Actor | null) {
  if (!actorInput) throw errors.unauthenticated();
  const updated = await ctx.db
    .update(schema.privacyRequests)
    .set({
      status: "rejected",
      completedAt: ctx.clock.now(),
      notes: "Cancelled by the account holder",
    })
    .where(
      and(
        eq(schema.privacyRequests.userId, actorInput.userId),
        eq(schema.privacyRequests.type, "delete"),
        eq(schema.privacyRequests.status, "received"),
      ),
    )
    .returning({ id: schema.privacyRequests.id });
  if (updated.length === 0) throw errors.conflict("There's no pending request to cancel.");
  await writeAudit(ctx, actorInput, {
    action: "privacy.delete.cancel",
    targetType: "privacy_request",
    targetId: updated[0]?.id,
    summary: "Cancelled their deletion request",
  });
}

// --- Admin queue -----------------------------------------------------------------------------------

export async function listPrivacyRequests(
  ctx: ServerContext,
  actorInput: Actor | null,
  filter: { open?: boolean } = {},
) {
  await authorize(ctx, actorInput, "privacy.manage");
  return ctx.db
    .select({
      id: schema.privacyRequests.id,
      userId: schema.privacyRequests.userId,
      email: schema.privacyRequests.email,
      name: schema.users.name,
      type: schema.privacyRequests.type,
      status: schema.privacyRequests.status,
      notes: schema.privacyRequests.notes,
      requestedAt: schema.privacyRequests.requestedAt,
      completedAt: schema.privacyRequests.completedAt,
    })
    .from(schema.privacyRequests)
    .leftJoin(schema.users, eq(schema.users.id, schema.privacyRequests.userId))
    .where(
      filter.open
        ? inArray(schema.privacyRequests.status, ["received", "in_progress"])
        : sql`1 = 1`,
    )
    .orderBy(desc(schema.privacyRequests.requestedAt))
    .limit(200)
    .all();
}

async function isLastActiveOwner(ctx: ServerContext, userId: string): Promise<boolean> {
  const others = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(
      and(
        eq(schema.roles.key, "owner"),
        eq(schema.users.status, "active"),
        sql`${schema.users.id} != ${userId}`,
      ),
    )
    .get();
  return Number(others?.n ?? 0) === 0 && (await activeOwnerExists(ctx));
}

/** Removes the person's identity from the account; history keeps a pseudonymous id only. */
async function anonymiseUser(ctx: ServerContext, actor: Actor, userId: string) {
  const user = await ctx.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .get();
  if (!user) throw errors.conflict("This account has already been deleted.");
  const access = await loadUserAccess(ctx.db, userId);
  if (!canManageUser(actor, { userId, rank: access.rank })) {
    throw errors.forbidden({ reason: "rank" });
  }
  if (access.roles.includes("owner") && (await isLastActiveOwner(ctx, userId))) {
    throw errors.conflict("The last active Owner can't be deleted.");
  }
  // Tell them first: afterwards the address is gone.
  await sendSecurityNotice(
    ctx,
    user,
    "Your VORA account has been deleted",
    "As you asked, your VORA account has been deleted. You've been signed out everywhere and can no longer sign in with this account.",
  );
  const now = ctx.clock.now();
  await revokeUserSessions(ctx, userId, "account_deleted");
  await ctx.db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
  await ctx.db.delete(schema.clientOrgMembers).where(eq(schema.clientOrgMembers.userId, userId));
  await ctx.db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
  await ctx.db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
  await ctx.db
    .update(schema.users)
    .set({
      email: `deleted-${userId.toLowerCase()}@deleted.invalid`,
      name: "Deleted user",
      passwordHash: null,
      status: "deactivated",
      mfaEnforced: false,
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId));
  await recordSecurityEvent(ctx, {
    type: "privacy.account_deleted",
    severity: "medium",
    userId,
    details: { by: actor.userId },
  });
}

export async function handlePrivacyRequest(
  ctx: ServerContext,
  actorInput: Actor | null,
  requestId: string,
  input: { action: "start" | "complete" | "reject"; note?: string },
): Promise<void> {
  const actor = await authorize(ctx, actorInput, "privacy.manage");
  if (!isId(requestId, "privacyRequest")) throw errors.notFound();
  const request = await ctx.db
    .select()
    .from(schema.privacyRequests)
    .where(eq(schema.privacyRequests.id, requestId))
    .get();
  if (!request) throw errors.notFound();
  if (request.status === "completed" || request.status === "rejected") {
    throw errors.conflict("This request is already closed.");
  }
  const note = input.note?.trim().slice(0, 1000) || null;
  const now = ctx.clock.now();
  if (input.action === "complete" && request.type === "delete") {
    if (!request.userId) throw errors.conflict("This account no longer exists.");
    await anonymiseUser(ctx, actor, request.userId);
  }
  const status =
    input.action === "start"
      ? "in_progress"
      : input.action === "complete"
        ? "completed"
        : "rejected";
  await ctx.db
    .update(schema.privacyRequests)
    .set({
      status,
      handledBy: actor.userId,
      completedAt: status === "in_progress" ? null : now,
      notes: note ?? request.notes,
      // A completed deletion keeps no contact address on the request either.
      ...(status === "completed" && request.type === "delete"
        ? { email: "deleted@deleted.invalid" }
        : {}),
    })
    .where(eq(schema.privacyRequests.id, requestId));
  await writeAudit(ctx, actor, {
    action: `privacy.${request.type}.${input.action}`,
    targetType: "privacy_request",
    targetId: requestId,
    summary:
      input.action === "complete" && request.type === "delete"
        ? "Completed an account deletion"
        : `Marked a ${request.type} request ${status.replace("_", " ")}`,
  });
  if (input.action === "reject" && request.type === "delete" && request.userId) {
    const user = await ctx.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.id, request.userId), isNull(schema.users.deletedAt)))
      .get();
    if (user) {
      await sendSecurityNotice(
        ctx,
        user,
        "About your deletion request",
        note
          ? `Your request to delete your VORA account wasn't completed: ${note}`
          : "Your request to delete your VORA account wasn't completed. Reply to this email or contact VORA if you have questions.",
      );
    }
  }
}

/** Requests waiting for someone with privacy.manage (dashboard / navigation). */
export async function openPrivacyRequestCount(ctx: ServerContext): Promise<number> {
  const row = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.privacyRequests)
    .where(
      or(
        eq(schema.privacyRequests.status, "received"),
        eq(schema.privacyRequests.status, "in_progress"),
      ),
    )
    .get();
  return Number(row?.n ?? 0);
}
