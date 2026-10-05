import { and, eq, gt, isNull } from "drizzle-orm";
import type { ServerContext } from "../context";
import { runBatch, type Statement, schema } from "../db/client";
import { sendSensitive } from "../email/outbox";
import { randomToken, sha256Hex } from "../lib/crypto";
import { errors } from "../lib/errors";
import { newId } from "../lib/ids";
import { DAY } from "../lib/time";
import { writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";
import { isFlagEnabled } from "../services/flags";
import { notifyPermissionHolders } from "../services/notifications";
import { generateRecoveryCodes } from "./mfa";
import { breachCount, checkPasswordPolicy } from "./password";
import { passwordHashing } from "./password-hashing";
import { authorize, canGrantRole, getRolesByKey, loadUserAccess } from "./rbac";
import { type CreatedSession, createSession } from "./sessions";
import type { Actor } from "./types";

export const INVITE_TTL = 3 * DAY;

export async function createInvitation(
  ctx: ServerContext,
  actorInput: Actor | null,
  input: { email: string; name?: string; roleKeys: string[]; clientOrgId?: string | null },
): Promise<{ invitationId: string }> {
  const actor = await authorize(ctx, actorInput, "users.invite");
  const email = input.email.trim().toLowerCase();
  const roleKeys = [...new Set(input.roleKeys)];
  if (roleKeys.length === 0) throw errors.validation({ roleKeys: "Choose at least one role." });

  const roles = await getRolesByKey(ctx.db, roleKeys);
  if (roles.length !== roleKeys.length) throw errors.validation({ roleKeys: "Unknown role." });
  for (const role of roles) {
    if (!canGrantRole(actor, role.rank, role.key)) {
      await recordSecurityEvent(ctx, {
        type: "authz.denied",
        severity: "medium",
        userId: actor.userId,
        details: { attempted: "invite_role", role: role.key },
      });
      throw errors.forbidden({ role: role.key });
    }
  }
  if (roleKeys.includes("client") && input.clientOrgId) {
    const org = await ctx.db
      .select({ id: schema.clientOrgs.id })
      .from(schema.clientOrgs)
      .where(eq(schema.clientOrgs.id, input.clientOrgId))
      .get();
    if (!org) throw errors.validation({ clientOrgId: "Unknown client organisation." });
  }

  const existing = await ctx.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (existing) throw errors.conflict("A user with this email already exists.");

  const now = ctx.clock.now();
  const token = randomToken(32);
  const invitationId = newId("invitation", now);
  await ctx.db.batch([
    ctx.db
      .update(schema.invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.invitations.email, email),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
        ),
      ),
    ctx.db.insert(schema.invitations).values({
      id: invitationId,
      email,
      name: input.name?.trim() || null,
      roleKeys,
      clientOrgId: input.clientOrgId ?? null,
      invitedBy: actor.userId,
      tokenHash: await sha256Hex(token),
      expiresAt: now + INVITE_TTL,
      createdAt: now,
    }),
  ]);

  const sent = await sendSensitive(ctx, {
    template: "invitation",
    to: email,
    data: {
      inviterName: actor.name,
      roleNames: roles.map((r) => r.name).join(" and "),
      url: `${ctx.config.origin}/invite/${token}`,
      days: INVITE_TTL / DAY,
    },
    related: { type: "invitation", id: invitationId },
  });
  await writeAudit(ctx, actor, {
    action: "user.invite",
    targetType: "invitation",
    targetId: invitationId,
    summary: `Invited ${roleKeys.join(", ")} user`,
    changes: { roles: roleKeys, emailSent: sent.ok },
  });
  if (!sent.ok)
    throw errors.unavailable(
      "The invitation was created but the email could not be sent. Try again.",
    );
  return { invitationId };
}

async function findInvitation(ctx: ServerContext, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return ctx.db
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.tokenHash, await sha256Hex(token)),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
        gt(schema.invitations.expiresAt, ctx.clock.now()),
      ),
    )
    .get();
}

export async function getInvitationPreview(ctx: ServerContext, token: string) {
  const invitation = await findInvitation(ctx, token);
  if (!invitation) return null;
  return {
    email: invitation.email,
    name: invitation.name,
    roleKeys: invitation.roleKeys,
    /** A public registration (no inviter) rather than an invitation sent by VORA. */
    selfRegistration: invitation.invitedBy === null,
  };
}

export interface AcceptedInvitation {
  session: CreatedSession;
  recoveryCodes: string[] | null;
  userId: string;
}

/**
 * Accepts an invitation: creates the account (email counts as verified — the link proves
 * possession), grants the roles, and for privileged roles issues recovery codes shown once.
 */
export async function acceptInvitation(
  ctx: ServerContext,
  token: string,
  input: { name: string; password: string },
  options: { selfRegistration?: boolean } = {},
): Promise<AcceptedInvitation> {
  const invitation = await findInvitation(ctx, token);
  if (!invitation) throw errors.validation({ _form: "This invitation is invalid or has expired." });
  // `/verify-email` completes public registrations only; it never accepts a staff invitation.
  if (
    options.selfRegistration &&
    (invitation.invitedBy !== null ||
      invitation.roleKeys.length !== 1 ||
      !["client", "member"].includes(invitation.roleKeys[0] ?? ""))
  ) {
    throw errors.validation({ _form: "This link is invalid or has expired." });
  }

  const problem = checkPasswordPolicy(input.password, {
    email: invitation.email,
    name: input.name,
  });
  if (problem) throw errors.validation({ password: problem });
  if (await isFlagEnabled(ctx, "auth.breach_check")) {
    const seen = await breachCount(input.password);
    if (seen && seen > 0) {
      throw errors.validation({
        password:
          "This password has appeared in a known data breach. Please choose a different one.",
      });
    }
  }

  // Hash BEFORE claiming the single-use invitation: if hashing is unavailable (503), the invitation
  // still works for a retry instead of being marked accepted with no account created.
  const passwordHash = await passwordHashing(ctx).hash(input.password);
  const now = ctx.clock.now();
  const claimed = await ctx.db
    .update(schema.invitations)
    .set({ acceptedAt: now })
    .where(
      and(
        eq(schema.invitations.id, invitation.id),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
      ),
    )
    .returning({ id: schema.invitations.id });
  if (claimed.length === 0)
    throw errors.validation({ _form: "This invitation has already been used." });

  const roles = await getRolesByKey(ctx.db, invitation.roleKeys);
  const userId = newId("user", now);
  const statements: Statement[] = [
    ctx.db.insert(schema.users).values({
      id: userId,
      email: invitation.email,
      emailVerifiedAt: now,
      name: input.name,
      passwordHash,
      status: "active",
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
    ...roles.map((role) =>
      ctx.db
        .insert(schema.userRoles)
        .values({ userId, roleId: role.id, grantedBy: invitation.invitedBy, grantedAt: now }),
    ),
    ctx.db.insert(schema.mfaFactors).values({
      id: newId("factor", now),
      userId,
      type: "email_otp",
      label: "Email",
      verifiedAt: now,
      createdAt: now,
    }),
    ctx.db
      .update(schema.invitations)
      .set({ acceptedUserId: userId })
      .where(eq(schema.invitations.id, invitation.id)),
  ];
  if (invitation.clientOrgId && invitation.roleKeys.includes("client")) {
    statements.push(
      ctx.db
        .insert(schema.clientOrgMembers)
        .values({ orgId: invitation.clientOrgId, userId, orgRole: "member", createdAt: now }),
    );
  }
  await runBatch(ctx.db, statements);

  const access = await loadUserAccess(ctx.db, userId);
  const recoveryCodes = access.privileged ? await generateRecoveryCodes(ctx, userId) : null;
  const session = await createSession(ctx, {
    userId,
    authLevel: "full",
    authMethod: "invitation",
    privileged: access.privileged,
    mfaVerified: true,
  });
  const selfRegistered = invitation.invitedBy === null;
  await writeAudit(
    ctx,
    { userId, roles: access.roles },
    selfRegistered
      ? {
          action: "user.register",
          targetType: "user",
          targetId: userId,
          summary: `Registered a ${access.roles.join(", ")} account`,
          changes: { roles: access.roles },
        }
      : {
          action: "user.invitation.accept",
          targetType: "user",
          targetId: userId,
          summary: "Accepted invitation and created account",
          changes: { roles: access.roles },
        },
  );
  if (selfRegistered && access.roles.includes("client")) {
    // A new client account sees no projects until VORA links it to an organisation.
    await notifyPermissionHolders(ctx, "clients.manage", {
      type: "client.registered",
      title: `New client account: ${input.name}`,
      body: "Link the account to a client organisation so they can see their projects.",
      link: `/admin/users/${userId}`,
    });
  }
  return { session, recoveryCodes, userId };
}
