import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { readCookie, serializeCookie } from "../lib/cookies";
import { hmacHex, randomToken, sha256Hex } from "../lib/crypto";
import { DAY, HOUR, MINUTE } from "../lib/time";
import { hashIp } from "../observability/audit";
import { loadUserAccess } from "./rbac";
import type { Actor, PendingSession } from "./types";

/** Session lifetimes (see docs/01-ARCHITECTURE.md §5.1). */
export const SESSION_POLICY = {
  privileged: { idle: 2 * HOUR, absolute: 12 * HOUR },
  standard: { idle: 7 * DAY, absolute: 30 * DAY },
  pendingMfa: { idle: 10 * MINUTE, absolute: 10 * MINUTE },
  touchInterval: 5 * MINUTE,
  elevation: 10 * MINUTE,
} as const;

/**
 * `__Host-` cookies are only accepted over HTTPS, bound to this exact host, Path=/ and no Domain.
 * Plain-HTTP local development uses an unprefixed name with the same flags minus Secure.
 */
export function sessionCookieName(ctx: Pick<ServerContext, "config">): string {
  return ctx.config.origin.startsWith("https://") ? "__Host-vora_session" : "vora_session";
}

export function sessionCookie(
  ctx: Pick<ServerContext, "config">,
  token: string,
  maxAgeMs: number,
): string {
  return serializeCookie(sessionCookieName(ctx), token, {
    maxAgeSeconds: Math.floor(maxAgeMs / 1000),
    httpOnly: true,
    secure: ctx.config.origin.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
  });
}

export function clearSessionCookie(ctx: Pick<ServerContext, "config">): string {
  return serializeCookie(sessionCookieName(ctx), "", {
    maxAgeSeconds: 0,
    httpOnly: true,
    secure: ctx.config.origin.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
  });
}

export function readSessionToken(
  ctx: Pick<ServerContext, "config">,
  request: Request,
): string | undefined {
  const value = readCookie(request, sessionCookieName(ctx));
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

export async function deviceHash(ctx: ServerContext): Promise<string> {
  return hmacHex(ctx.config.authSecrets[0] as string, "device-hash", ctx.meta.userAgent);
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  cookie: string;
  expiresAt: number;
}

export async function createSession(
  ctx: ServerContext,
  input: {
    userId: string;
    authLevel: "pending_mfa" | "full";
    authMethod: string;
    privileged: boolean;
    mfaVerified: boolean;
  },
): Promise<CreatedSession> {
  const now = ctx.clock.now();
  const policy =
    input.authLevel === "pending_mfa"
      ? SESSION_POLICY.pendingMfa
      : input.privileged
        ? SESSION_POLICY.privileged
        : SESSION_POLICY.standard;
  const token = randomToken(32);
  const sessionId = await sha256Hex(token);
  const expiresAt = now + policy.absolute;
  await ctx.db.insert(schema.sessions).values({
    id: sessionId,
    userId: input.userId,
    authLevel: input.authLevel,
    authMethod: input.authMethod,
    mfaVerifiedAt: input.mfaVerified ? now : null,
    elevatedUntil: null,
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: now + policy.idle,
    expiresAt,
    ipHash: await hashIp(ctx),
    ipPrefix: ctx.meta.ipPrefix,
    country: ctx.meta.country,
    city: ctx.meta.city,
    asn: ctx.meta.asn,
    userAgent: ctx.meta.userAgent.slice(0, 256),
    deviceHash: await deviceHash(ctx),
  });
  // The cookie lives as long as the absolute lifetime; the server enforces idle expiry.
  return { token, sessionId, cookie: sessionCookie(ctx, token, policy.absolute), expiresAt };
}

export type ResolvedSession =
  | { kind: "none" }
  | { kind: "pending"; pending: PendingSession }
  | { kind: "full"; actor: Actor };

/**
 * Validates the session cookie against the database on every request: not revoked, not past its
 * idle or absolute expiry, user still active, and 2FA satisfied if the user's roles require it.
 */
export async function resolveSession(
  ctx: ServerContext,
  request: Request,
): Promise<ResolvedSession> {
  const token = readSessionToken(ctx, request);
  if (!token) return { kind: "none" };
  const sessionId = await sha256Hex(token);
  const now = ctx.clock.now();

  const row = await ctx.db
    .select({
      session: schema.sessions,
      user: {
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        status: schema.users.status,
        mfaEnforced: schema.users.mfaEnforced,
        passwordChangedAt: schema.users.passwordChangedAt,
      },
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
    .get();

  if (!row) return { kind: "none" };
  const { session, user } = row;
  if (session.expiresAt <= now || session.idleExpiresAt <= now) return { kind: "none" };
  if (user.status !== "active") return { kind: "none" };

  if (session.authLevel === "pending_mfa") {
    return {
      kind: "pending",
      pending: { sessionId, userId: user.id, email: user.email, expiresAt: session.expiresAt },
    };
  }

  const access = await loadUserAccess(ctx.db, user.id);
  // A user who became privileged after signing in without 2FA must complete it now.
  if ((access.privileged || user.mfaEnforced) && !session.mfaVerifiedAt) {
    return { kind: "none" };
  }

  if (now - session.lastSeenAt > SESSION_POLICY.touchInterval) {
    const policy = access.privileged ? SESSION_POLICY.privileged : SESSION_POLICY.standard;
    const idleExpiresAt = Math.min(session.expiresAt, now + policy.idle);
    ctx.waitUntil(
      ctx.db
        .update(schema.sessions)
        .set({ lastSeenAt: now, idleExpiresAt })
        .where(eq(schema.sessions.id, sessionId))
        .run()
        .catch((error: unknown) => ctx.log.warn("session_touch_failed", { error: String(error) })),
    );
  }

  return {
    kind: "full",
    actor: {
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: access.roles,
      rank: access.rank,
      privileged: access.privileged,
      permissions: access.permissions,
      session: {
        id: sessionId,
        authLevel: "full",
        authMethod: session.authMethod,
        createdAt: session.createdAt,
        mfaVerifiedAt: session.mfaVerifiedAt,
        elevatedUntil: session.elevatedUntil,
        expiresAt: session.expiresAt,
      },
    },
  };
}

export async function revokeSession(
  ctx: ServerContext,
  sessionId: string,
  reason: string,
): Promise<boolean> {
  const result = await ctx.db
    .update(schema.sessions)
    .set({ revokedAt: ctx.clock.now(), revokedReason: reason })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Revokes every live session for a user, optionally keeping the current one. Returns the count. */
export async function revokeUserSessions(
  ctx: ServerContext,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const conditions = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(schema.sessions.id, exceptSessionId));
  const result = await ctx.db
    .update(schema.sessions)
    .set({ revokedAt: ctx.clock.now(), revokedReason: reason })
    .where(and(...conditions))
    .run();
  return result.meta.changes ?? 0;
}

export async function listActiveSessions(ctx: ServerContext, userId: string) {
  const now = ctx.clock.now();
  return ctx.db
    .select({
      id: schema.sessions.id,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      expiresAt: schema.sessions.expiresAt,
      country: schema.sessions.country,
      city: schema.sessions.city,
      userAgent: schema.sessions.userAgent,
      authMethod: schema.sessions.authMethod,
      authLevel: schema.sessions.authLevel,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, now),
        gt(schema.sessions.idleExpiresAt, now),
        eq(schema.sessions.authLevel, "full"),
      ),
    )
    .orderBy(schema.sessions.lastSeenAt)
    .all();
}

/** Marks the session as recently re-authenticated (step-up) for sensitive actions. */
export async function elevateSession(ctx: ServerContext, sessionId: string): Promise<number> {
  const until = ctx.clock.now() + SESSION_POLICY.elevation;
  await ctx.db
    .update(schema.sessions)
    .set({ elevatedUntil: until })
    .where(eq(schema.sessions.id, sessionId))
    .run();
  return until;
}
