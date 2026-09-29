import { and, eq, sql } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { timingSafeEqual } from "../lib/crypto";
import { errors } from "../lib/errors";
import { newId } from "../lib/ids";
import { writeAudit } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";
import { generateRecoveryCodes } from "./mfa";
import { checkPasswordPolicy } from "./password";
import { passwordHashing } from "./password-hashing";
import { syncRbac } from "./rbac";
import { type CreatedSession, createSession } from "./sessions";

export async function activeOwnerExists(ctx: ServerContext): Promise<boolean> {
  const row = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(and(eq(schema.roles.key, "owner"), eq(schema.users.status, "active")))
    .get();
  return Number(row?.n ?? 0) > 0;
}

/** `/setup` is available only while no active Owner exists AND a SETUP_TOKEN secret is configured. */
export async function isSetupAvailable(ctx: ServerContext): Promise<boolean> {
  return Boolean(ctx.config.setupToken) && !(await activeOwnerExists(ctx));
}

/**
 * Creates the first Owner. Guarded three ways: setup token (constant-time compare), "no owner
 * exists", and a unique bootstrap marker row so two concurrent requests cannot both succeed.
 */
export async function bootstrapOwner(
  ctx: ServerContext,
  input: { setupToken: string; name: string; email: string; password: string },
): Promise<{ session: CreatedSession; recoveryCodes: string[] }> {
  const expected = ctx.config.setupToken;
  if (!expected || !timingSafeEqual(input.setupToken, expected)) {
    await recordSecurityEvent(ctx, { type: "auth.setup.rejected", severity: "high" });
    throw errors.forbidden();
  }
  if (await activeOwnerExists(ctx)) throw errors.notFound();

  const email = input.email.trim().toLowerCase();
  const problem = checkPasswordPolicy(input.password, { email, name: input.name });
  if (problem) throw errors.validation({ password: problem });

  const now = ctx.clock.now();
  await syncRbac(ctx.db, now);
  const owner = await ctx.db.select().from(schema.roles).where(eq(schema.roles.key, "owner")).get();
  if (!owner) throw errors.config({ missing: "owner role" });

  // Hashed OUTSIDE the try below: that catch turns any failure into "Setup has already been
  // completed", which would misreport a hashing outage (503) as a completed setup.
  const passwordHash = await passwordHashing(ctx).hash(input.password);
  const userId = newId("user", now);
  try {
    await ctx.db.batch([
      // Unique marker: the second concurrent bootstrap fails here and nothing else is written.
      ctx.db
        .insert(schema.siteSettings)
        .values({ key: "system.bootstrap", value: { at: now, userId }, updatedAt: now }),
      ctx.db.insert(schema.users).values({
        id: userId,
        email,
        emailVerifiedAt: now,
        name: input.name.trim(),
        passwordHash,
        status: "active",
        passwordChangedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      ctx.db
        .insert(schema.userRoles)
        .values({ userId, roleId: owner.id, grantedBy: null, grantedAt: now }),
      ctx.db.insert(schema.mfaFactors).values({
        id: newId("factor", now),
        userId,
        type: "email_otp",
        label: "Email",
        verifiedAt: now,
        createdAt: now,
      }),
    ]);
  } catch {
    throw errors.conflict("Setup has already been completed.");
  }

  const recoveryCodes = await generateRecoveryCodes(ctx, userId);
  const session = await createSession(ctx, {
    userId,
    authLevel: "full",
    authMethod: "setup",
    privileged: true,
    mfaVerified: true,
  });
  await recordSecurityEvent(ctx, { type: "auth.owner.bootstrapped", severity: "high", userId });
  await writeAudit(
    ctx,
    { userId, roles: ["owner"] },
    {
      action: "system.bootstrap",
      targetType: "user",
      targetId: userId,
      summary: "Created the first Owner account",
    },
  );
  return { session, recoveryCodes };
}
