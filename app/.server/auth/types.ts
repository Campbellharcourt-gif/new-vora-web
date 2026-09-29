import type { Permission } from "@shared/permissions";

export interface SessionInfo {
  id: string;
  authLevel: "pending_mfa" | "full";
  authMethod: string;
  createdAt: number;
  mfaVerifiedAt: number | null;
  elevatedUntil: number | null;
  expiresAt: number;
}

/** A signed-in user with their effective access, resolved on the server for every request. */
export interface Actor {
  userId: string;
  email: string;
  name: string;
  roles: string[];
  /** Highest rank among the user's roles (used for "manage only lower-ranked users"). */
  rank: number;
  /** True if any role is privileged (2FA mandatory). */
  privileged: boolean;
  permissions: ReadonlySet<Permission>;
  session: SessionInfo;
}

export interface PendingSession {
  sessionId: string;
  userId: string;
  email: string;
  expiresAt: number;
}

export function actorCan(actor: Actor | null | undefined, permission: Permission): boolean {
  return Boolean(actor?.permissions.has(permission));
}

export function isElevated(actor: Actor, now: number): boolean {
  return (actor.session.elevatedUntil ?? 0) > now;
}
