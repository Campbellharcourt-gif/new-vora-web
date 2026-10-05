/** Enumerations shared by the database schema, services and UI. Values are stored verbatim. */

export const USER_STATUSES = ["invited", "active", "suspended", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ENQUIRY_STATUSES = [
  "received",
  "processing",
  "contacted",
  "qualified",
  "won",
  "lost",
  "archived",
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  received: "Received",
  processing: "Processing",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

/** Allowed status transitions. Anything not listed is rejected by the service. */
export const ENQUIRY_TRANSITIONS: Record<EnquiryStatus, readonly EnquiryStatus[]> = {
  received: ["processing", "contacted", "qualified", "lost", "archived"],
  processing: ["contacted", "qualified", "lost", "archived"],
  contacted: ["processing", "qualified", "won", "lost", "archived"],
  qualified: ["contacted", "won", "lost", "archived"],
  won: ["archived"],
  lost: ["processing", "archived"],
  archived: ["processing"],
};

export const CONTENT_STATUSES = ["draft", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const JOB_ROLE_STATUSES = ["draft", "open", "closed", "archived"] as const;
export type JobRoleStatus = (typeof JOB_ROLE_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "received",
  "reviewing",
  "interviewing",
  "offer",
  "hired",
  "declined",
  "withdrawn",
  "archived",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ENGAGEMENT_STATUSES = [
  "planning",
  "in_progress",
  "review",
  "delivered",
  "on_hold",
  "closed",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, string> = {
  planning: "Planning",
  in_progress: "In progress",
  review: "In review",
  delivered: "Delivered",
  on_hold: "On hold",
  closed: "Closed",
};

export const MILESTONE_STATUSES = ["upcoming", "in_progress", "done", "blocked"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  upcoming: "Upcoming",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

export const SERVICE_DELIVERY_MODELS = ["vora", "partner", "joint"] as const;
export type ServiceDeliveryModel = (typeof SERVICE_DELIVERY_MODELS)[number];

export const SECURITY_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

export const LOGIN_OUTCOMES = [
  "success",
  "bad_credentials",
  "locked",
  "suspended",
  "mfa_passed",
  "mfa_failed",
  "recovery_used",
  "rate_limited",
  "challenge_failed",
] as const;
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number];

export const MFA_FACTOR_TYPES = ["email_otp", "totp", "sms", "webauthn"] as const;
export type MfaFactorType = (typeof MFA_FACTOR_TYPES)[number];

export const MEDIA_KINDS = [
  "image",
  "video",
  "model",
  "document",
  "font",
  "audio",
  "other",
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const EMAIL_STATUSES = ["queued", "sending", "sent", "failed", "dead"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const AI_USAGE_STATUSES = [
  "ok",
  "error",
  "timeout",
  "rate_limited",
  "blocked",
  "malformed",
  "disabled",
] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

/** Project types offered on the enquiry form (keys map to service slugs where they exist). */
export const ENQUIRY_PROJECT_TYPES = [
  { key: "websites", label: "Website or digital platform" },
  { key: "branding", label: "Branding" },
  { key: "motion", label: "Motion" },
  { key: "film", label: "Film" },
  { key: "not_sure", label: "Not sure yet" },
] as const;
export type EnquiryProjectType = (typeof ENQUIRY_PROJECT_TYPES)[number]["key"];
