import {
  ENGAGEMENT_STATUS_LABELS,
  ENQUIRY_STATUS_LABELS,
  type EngagementStatus,
  type EnquiryStatus,
  MILESTONE_STATUS_LABELS,
  type MilestoneStatus,
} from "@shared/enums";
import { StatusIndicator, type StatusKind } from "~/components/vora/primitives";

/** Enquiry states as status squares + labels (design system StatusIndicator colours). */
const ENQUIRY_KIND: Record<EnquiryStatus, StatusKind> = {
  received: "info",
  processing: "warn",
  contacted: "info",
  qualified: "ok",
  won: "ok",
  lost: "muted",
  archived: "muted",
};

export function EnquiryStatusTag({ status }: { status: EnquiryStatus }) {
  return (
    <StatusIndicator kind={ENQUIRY_KIND[status] ?? "muted"}>
      {ENQUIRY_STATUS_LABELS[status] ?? status}
    </StatusIndicator>
  );
}

/** System health states (admin): the internal labels, with the public status colours. */
const HEALTH_KIND: Record<string, StatusKind> = {
  operational: "ok",
  degraded: "warn",
  down: "down",
  not_configured: "muted",
};

export function HealthTag({ state, label }: { state: string; label: string }) {
  return <StatusIndicator kind={HEALTH_KIND[state] ?? "muted"}>{label}</StatusIndicator>;
}

/** CMS state: what the public sees, and whether the working copy differs from it. */
export function ContentStatusTag(props: { status: string; hasUnpublishedChanges: boolean }) {
  const { status, hasUnpublishedChanges } = props;
  if (status === "archived") return <StatusIndicator kind="muted">Archived</StatusIndicator>;
  if (status === "closed") return <StatusIndicator kind="muted">Closed</StatusIndicator>;
  if (status === "published" || status === "open") {
    return hasUnpublishedChanges ? (
      <StatusIndicator kind="warn">Live · unpublished changes</StatusIndicator>
    ) : (
      <StatusIndicator kind="ok">Live</StatusIndicator>
    );
  }
  return <StatusIndicator kind="info">Draft</StatusIndicator>;
}

const ENGAGEMENT_KIND: Record<EngagementStatus, StatusKind> = {
  planning: "info",
  in_progress: "ok",
  review: "warn",
  delivered: "ok",
  on_hold: "muted",
  closed: "muted",
};

export function EngagementStatusTag({ status }: { status: EngagementStatus }) {
  return (
    <StatusIndicator kind={ENGAGEMENT_KIND[status] ?? "muted"}>
      {ENGAGEMENT_STATUS_LABELS[status] ?? status}
    </StatusIndicator>
  );
}

const MILESTONE_KIND: Record<MilestoneStatus, StatusKind> = {
  upcoming: "muted",
  in_progress: "info",
  done: "ok",
  blocked: "warn",
};

export function MilestoneStatusTag({ status }: { status: MilestoneStatus }) {
  return (
    <StatusIndicator kind={MILESTONE_KIND[status] ?? "muted"}>
      {MILESTONE_STATUS_LABELS[status] ?? status}
    </StatusIndicator>
  );
}
