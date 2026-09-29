import { LOGIN_OUTCOMES, MFA_FACTOR_TYPES, USER_STATUSES } from "@shared/enums";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { inList, isBool, isJson } from "./_helpers";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerifiedAt: integer("email_verified_at"),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    status: text("status", { enum: USER_STATUSES }).notNull().default("invited"),
    passwordChangedAt: integer("password_changed_at"),
    lastLoginAt: integer("last_login_at"),
    lockedUntil: integer("locked_until"),
    mfaEnforced: integer("mfa_enforced", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_status_idx").on(t.status),
    check("users_status_ck", inList(t.status, USER_STATUSES)),
    check("users_mfa_enforced_ck", isBool(t.mfaEnforced)),
    check("users_email_lower_ck", sql`${t.email} = lower(${t.email})`),
    check(
      "users_active_has_password_ck",
      sql`${t.status} != 'active' or ${t.passwordHash} is not null`,
    ),
  ],
);

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    rank: integer("rank").notNull(),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    isPrivileged: integer("is_privileged", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("roles_key_uq").on(t.key),
    check("roles_rank_ck", sql`${t.rank} between 0 and 100`),
    check("roles_is_system_ck", isBool(t.isSystem)),
    check("roles_is_privileged_ck", isBool(t.isPrivileged)),
    check("roles_key_ck", sql`${t.key} glob '[a-z]*' and length(${t.key}) <= 40`),
  ],
);

export const permissions = sqliteTable("permissions", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    index("role_permissions_perm_idx").on(t.permissionKey),
  ],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: integer("granted_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_role_idx").on(t.roleId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 (hex) of the cookie token. The raw token is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authLevel: text("auth_level", { enum: ["pending_mfa", "full"] }).notNull(),
    authMethod: text("auth_method").notNull(),
    mfaVerifiedAt: integer("mfa_verified_at"),
    elevatedUntil: integer("elevated_until"),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    idleExpiresAt: integer("idle_expires_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    ipHash: text("ip_hash"),
    ipPrefix: text("ip_prefix"),
    country: text("country"),
    city: text("city"),
    asn: integer("asn"),
    userAgent: text("user_agent"),
    deviceHash: text("device_hash"),
    revokedAt: integer("revoked_at"),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId, t.revokedAt),
    index("sessions_expires_idx").on(t.expiresAt),
    check("sessions_auth_level_ck", inList(t.authLevel, ["pending_mfa", "full"])),
    check("sessions_expiry_ck", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const mfaFactors = sqliteTable(
  "mfa_factors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: MFA_FACTOR_TYPES }).notNull(),
    label: text("label").notNull(),
    secretEnc: text("secret_enc"),
    phoneEnc: text("phone_enc"),
    verifiedAt: integer("verified_at"),
    lastUsedAt: integer("last_used_at"),
    disabledAt: integer("disabled_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("mfa_factors_user_idx").on(t.userId, t.type),
    check("mfa_factors_type_ck", inList(t.type, MFA_FACTOR_TYPES)),
  ],
);

export const mfaChallenges = sqliteTable(
  "mfa_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    factorId: text("factor_id").references(() => mfaFactors.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["login", "step_up", "verify_factor"] }).notNull(),
    codeHmac: text("code_hmac").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [
    index("mfa_challenges_session_idx").on(t.sessionId),
    index("mfa_challenges_user_idx").on(t.userId, t.createdAt),
    check("mfa_challenges_purpose_ck", inList(t.purpose, ["login", "step_up", "verify_factor"])),
    check(
      "mfa_challenges_attempts_ck",
      sql`${t.attempts} >= 0 and ${t.maxAttempts} between 1 and 10`,
    ),
  ],
);

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    codeHmac: text("code_hmac").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("recovery_codes_user_code_uq").on(t.userId, t.codeHmac),
    index("recovery_codes_user_idx").on(t.userId, t.usedAt),
  ],
);

export const AUTH_TOKEN_TYPES = ["password_reset", "email_verify", "email_change"] as const;

export const authTokens = sqliteTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: AUTH_TOKEN_TYPES }).notNull(),
    tokenHash: text("token_hash").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash),
    index("auth_tokens_user_idx").on(t.userId, t.type),
    check("auth_tokens_type_ck", inList(t.type, AUTH_TOKEN_TYPES)),
    check("auth_tokens_payload_ck", isJson(t.payload)),
  ],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    roleKeys: text("role_keys", { mode: "json" }).$type<string[]>().notNull(),
    clientOrgId: text("client_org_id"),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    acceptedUserId: text("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_email_idx").on(t.email),
    check("invitations_role_keys_ck", isJson(t.roleKeys)),
    check("invitations_email_lower_ck", sql`${t.email} = lower(${t.email})`),
  ],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    emailHmac: text("email_hmac"),
    outcome: text("outcome", { enum: LOGIN_OUTCOMES }).notNull(),
    riskScore: integer("risk_score").notNull().default(0),
    riskReasons: text("risk_reasons", { mode: "json" }).$type<string[]>(),
    ipHash: text("ip_hash"),
    ipPrefix: text("ip_prefix"),
    country: text("country"),
    city: text("city"),
    asn: integer("asn"),
    userAgent: text("user_agent"),
    deviceHash: text("device_hash"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("login_attempts_user_idx").on(t.userId, t.createdAt),
    index("login_attempts_email_idx").on(t.emailHmac, t.createdAt),
    index("login_attempts_ip_idx").on(t.ipHash, t.createdAt),
    check("login_attempts_outcome_ck", inList(t.outcome, LOGIN_OUTCOMES)),
    check("login_attempts_risk_ck", sql`${t.riskScore} between 0 and 100`),
    check("login_attempts_reasons_ck", isJson(t.riskReasons)),
  ],
);
