/**
 * Permission catalogue and default role composition.
 *
 * This file is the single source of truth for permission keys. The database mirrors it
 * (`permissions`, `role_permissions`) so roles can be composed and audited at runtime, but a
 * permission that is not listed here does not exist.
 */

export const PERMISSIONS = {
  "admin.access": "Enter the admin workspace",

  "enquiries.view": "View enquiries",
  "enquiries.edit": "Update enquiry status, notes and assignment",
  "enquiries.delete": "Delete or anonymise enquiries",
  "enquiries.export": "Export enquiries",

  "projects.view": "View projects in admin",
  "projects.create": "Create projects",
  "projects.edit": "Edit project drafts",
  "projects.publish": "Publish, archive and reorder projects",
  "projects.delete": "Permanently delete projects",

  "pages.view": "View pages in admin",
  "pages.edit": "Edit page drafts",
  "pages.publish": "Publish pages",

  "services.view": "View services in admin",
  "services.edit": "Edit service drafts",
  "services.publish": "Publish services",

  "partners.view": "View partners in admin",
  "partners.edit": "Edit partner drafts",
  "partners.publish": "Publish partners",

  "careers.view": "View job roles in admin",
  "careers.edit": "Edit job roles",
  "careers.publish": "Open, close and publish job roles",

  "applications.view": "View job applications",
  "applications.edit": "Update application status and notes",
  "applications.delete": "Delete applications",

  "media.view": "View the media library",
  "media.upload": "Upload media",
  "media.edit": "Edit media metadata and replace files",
  "media.delete": "Delete media",

  "clients.view": "View client organisations",
  "clients.manage": "Create and manage client organisations",
  "engagements.view": "View client engagements",
  "engagements.manage": "Manage engagements, milestones, deliverables, files and messages",

  "users.view": "View users",
  "users.invite": "Invite users",
  "users.manage": "Suspend users, reset 2FA and revoke sessions",
  "roles.assign": "Assign roles to users",
  "roles.manage": "Edit role composition",

  "settings.view": "View site settings",
  "settings.manage": "Change site settings",
  "social.manage": "Manage social links",
  "flags.manage": "Manage feature flags",
  "maintenance.manage": "Toggle maintenance mode and work during maintenance",

  "ai.use": "Use VORA AI admin tools",
  "ai.manage": "Configure VORA AI",
  "ai.usage.view": "View VORA AI usage and cost",

  "security.view": "View security events and sessions",
  "security.manage": "Acknowledge security events and revoke sessions for others",
  "audit.view": "View the audit log",

  "system.status": "View detailed system health",
  "system.jobs": "View background jobs and the email outbox",
  "privacy.manage": "Process data export and deletion requests",

  "client_portal.access": "Use the client portal",
  "member_portal.access": "Use the member area",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export function permissionCategory(permission: Permission): string {
  return permission.split(".")[0] ?? permission;
}

export const SYSTEM_ROLE_KEYS = ["owner", "admin", "manager", "staff", "client", "member"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface RoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  rank: number;
  /** Privileged roles must pass 2FA on every sign-in. */
  privileged: boolean;
  permissions: readonly Permission[];
}

const CONTENT_FULL: Permission[] = [
  "projects.view",
  "projects.create",
  "projects.edit",
  "projects.publish",
  "pages.view",
  "pages.edit",
  "pages.publish",
  "services.view",
  "services.edit",
  "services.publish",
  "partners.view",
  "partners.edit",
  "partners.publish",
  "careers.view",
  "careers.edit",
  "careers.publish",
];

const OWNER_ONLY: Permission[] = ["roles.manage"];

export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full control of VORA, including ownership and role composition.",
    rank: 100,
    privileged: true,
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== "client_portal.access" && p !== "member_portal.access",
    ),
  },
  {
    key: "admin",
    name: "Admin",
    description: "Runs the studio platform: content, users below Admin, settings, security and AI.",
    rank: 80,
    privileged: true,
    permissions: ALL_PERMISSIONS.filter(
      (p) =>
        !OWNER_ONLY.includes(p) && p !== "client_portal.access" && p !== "member_portal.access",
    ),
  },
  {
    key: "manager",
    name: "Manager",
    description: "Manages content, enquiries, careers and client engagements.",
    rank: 60,
    privileged: true,
    permissions: [
      "admin.access",
      "enquiries.view",
      "enquiries.edit",
      "enquiries.export",
      ...CONTENT_FULL,
      "applications.view",
      "applications.edit",
      "media.view",
      "media.upload",
      "media.edit",
      "clients.view",
      "clients.manage",
      "engagements.view",
      "engagements.manage",
      "users.view",
      "users.invite",
      "ai.use",
      "audit.view",
    ],
  },
  {
    key: "staff",
    name: "Staff",
    description:
      "Works on drafts, enquiries and assigned engagements. Cannot publish or administer.",
    rank: 40,
    privileged: true,
    permissions: [
      "admin.access",
      "enquiries.view",
      "enquiries.edit",
      "projects.view",
      "projects.create",
      "projects.edit",
      "pages.view",
      "services.view",
      "partners.view",
      "careers.view",
      "media.view",
      "media.upload",
      "media.edit",
      "clients.view",
      "engagements.view",
      "engagements.manage",
      "ai.use",
    ],
  },
  {
    key: "client",
    name: "Client",
    description: "Accesses their organisation's engagements in the client portal.",
    rank: 20,
    privileged: false,
    permissions: ["client_portal.access"],
  },
  {
    key: "member",
    name: "Member",
    description: "Accesses the VORA member area.",
    rank: 10,
    privileged: false,
    permissions: ["member_portal.access"],
  },
];

/** Bumped whenever DEFAULT_ROLES or PERMISSIONS change, so deployments re-sync the database. */
export const RBAC_VERSION = 1;

export function getRoleDefinition(key: string): RoleDefinition | undefined {
  return DEFAULT_ROLES.find((role) => role.key === key);
}
