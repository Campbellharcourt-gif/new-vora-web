import { ENQUIRY_STATUS_LABELS, type EnquiryStatus } from "@shared/enums";
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
