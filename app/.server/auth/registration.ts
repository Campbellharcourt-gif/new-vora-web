import type { SelfSignupAccountType } from "@shared/validation/auth";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { enqueueEmail, sendSensitive } from "../email/outbox";
import { randomToken, sha256Hex } from "../lib/crypto";
import { newId } from "../lib/ids";
import { HOUR } from "../lib/time";
import { describeError } from "../observability/logger";
import { isFlagEnabled } from "../services/flags";

/**
 * Public self-registration for Client and Member accounts (architecture §3.2, `/register`).
 *
 * Two steps, so a password is only ever set by someone who controls the email address:
 *   1. the visitor gives account type, name and email → we email a single-use link;
 *   2. the link (`/verify-email/:token`) lets them choose a password, which creates the account.
 * This removes account pre-hijacking (nobody can pre-register someone else's address with a
 * password they know) and makes step 1 answer identically whether or not the address already has
 * an account: existing accounts get an "you already have an account" email instead.
 *
 * A pending registration is an `invitations` row with no inviter, carrying exactly one role from
 * {client, member}. Owner, Admin, Manager and Staff can never be self-assigned: the role list is
 * fixed here, never read from the request. Acceptance reuses the invitation flow (password policy,
 * breach check, verified email, session).
 */

export const SELF_SIGNUP_ROLE: Record<SelfSignupAccountType, string> = {
  client: "client",
  member: "member",
};

export const REGISTRATION_POLICY = {
  ttl: 24 * HOUR,
  /** Links sent per address per hour — stops the form being used to flood an inbox. */
  maxPerEmailPerHour: 3,
} as const;

export const ACCOUNT_LABEL: Record<SelfSignupAccountType, string> = {
  client: "Client",
  member: "Member",
};

export async function isRegistrationOpen(ctx: ServerContext): Promise<boolean> {
  return isFlagEnabled(ctx, "accounts.self_signup");
}

/**
 * Step 1. Never reveals whether the address has an account: callers respond the same way in
 * every case. Run it with `startRegistrationInBackground` so timing doesn't reveal it either.
 */
export async function startRegistration(
  ctx: ServerContext,
  input: { accountType: SelfSignupAccountType; name: string; email: string },
): Promise<void> {
  if (!(await isRegistrationOpen(ctx))) return;
  const email = input.email.trim().toLowerCase();
  const now = ctx.clock.now();

  const existing = await ctx.db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (existing) {
    if (existing.deletedAt) return;
    // One notice per account per day at most (idempotency key), through the retried outbox.
    const day = Math.floor(now / (24 * HOUR));
    await enqueueEmail(ctx, {
      template: "accountExists",
      to: email,
      data: { name: existing.name, signInUrl: `${ctx.config.origin}/login` },
      idempotencyKey: `account-exists:${existing.id}:${day}`,
      related: { type: "user", id: existing.id },
    });
    return;
  }

  const recent = await ctx.db
    .select({ n: count() })
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.email, email),
        isNull(schema.invitations.invitedBy),
        gt(schema.invitations.createdAt, now - HOUR),
      ),
    )
    .get();
  if ((recent?.n ?? 0) >= REGISTRATION_POLICY.maxPerEmailPerHour) {
    ctx.log.warn("registration_email_limit", {});
    return;
  }

  const token = randomToken(32);
  const id = newId("invitation", now);
  await ctx.db.batch([
    // Only the newest self-registration link works; invitations sent by VORA are left alone.
    ctx.db
      .update(schema.invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.invitations.email, email),
          isNull(schema.invitations.invitedBy),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
        ),
      ),
    ctx.db.insert(schema.invitations).values({
      id,
      email,
      name: input.name.trim(),
      roleKeys: [SELF_SIGNUP_ROLE[input.accountType]],
      clientOrgId: null,
      invitedBy: null,
      tokenHash: await sha256Hex(token),
      expiresAt: now + REGISTRATION_POLICY.ttl,
      createdAt: now,
    }),
  ]);
  await sendSensitive(ctx, {
    template: "verifyEmail",
    to: email,
    data: {
      name: input.name.trim(),
      accountLabel: ACCOUNT_LABEL[input.accountType],
      url: `${ctx.config.origin}/verify-email/${token}`,
      hours: REGISTRATION_POLICY.ttl / HOUR,
    },
    related: { type: "invitation", id },
  });
}

/** The account lookup and email run after the response is sent (no timing oracle). */
export function startRegistrationInBackground(
  ctx: ServerContext,
  input: { accountType: SelfSignupAccountType; name: string; email: string },
): void {
  ctx.waitUntil(
    startRegistration(ctx, input).catch((error: unknown) =>
      ctx.log.error("registration_start_failed", describeError(error)),
    ),
  );
}
