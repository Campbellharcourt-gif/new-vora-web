import {
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_STATUSES,
  ENQUIRY_TRANSITIONS,
  type EnquiryStatus,
} from "@shared/enums";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { failureFrom, formString, load, requirePermission } from "~/.server/guards";
import { addEnquiryNote, changeEnquiryStatus, getEnquiry } from "~/.server/services/enquiries";
import { Button, ErrorSummary, Notice, TextArea } from "~/components/ui/forms";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/enquiry";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "enquiries.view");
  const { enquiry, events } = await getEnquiry(load(context).server, actor, params.id).catch(
    (error) => {
      failureFrom(error);
      throw error;
    },
  );
  return {
    enquiry,
    events,
    canEdit: actor.permissions.has("enquiries.edit"),
    transitions: ENQUIRY_TRANSITIONS[enquiry.status],
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "enquiries.edit");
  const { server } = load(context);
  const form = await request.formData();
  try {
    if (formString(form, "intent") === "note") {
      await addEnquiryNote(server, actor, params.id, formString(form, "note"));
      return { ok: true as const, message: "Note added." };
    }
    const to = formString(form, "status") as EnquiryStatus;
    if (!ENQUIRY_STATUSES.includes(to))
      return data({ ok: false as const, message: "Choose a status.", fields: {} }, { status: 400 });
    await changeEnquiryStatus(server, actor, params.id, to, formString(form, "note") || undefined);
    return { ok: true as const, message: `Status changed to ${ENQUIRY_STATUS_LABELS[to]}.` };
  } catch (error) {
    const failure = failureFrom(error);
    return data(
      { ok: false as const, message: failure.message, fields: failure.fields },
      { status: failure.status },
    );
  }
}

export default function EnquiryDetail({ loaderData }: Route.ComponentProps) {
  const { enquiry: e, events } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const rows: [string, string | null][] = [
    ["Name", e.name],
    ["Email", e.email],
    ["Company", e.company],
    ["Website", e.websiteUrl],
    ["Project", e.projectTypes.join(", ")],
    ["Budget", e.budgetLabel],
    ["Timeline", e.timelineDate ? `${e.timelineLabel} (${e.timelineDate})` : e.timelineLabel],
    ["Source", [e.sourceLabel, e.sourceDetail].filter(Boolean).join(" — ") || null],
    ["Spam score", String(e.spamScore)],
    ["Country", e.country],
  ];
  return (
    <>
      <PageHeading
        eyebrow="Enquiry"
        title={e.reference}
        description={`Received ${formatDateTime(e.createdAt)} · ${ENQUIRY_STATUS_LABELS[e.status]}`}
      />
      <p>
        <Link to="/admin/enquiries">← All enquiries</Link>
      </p>
      {result?.ok ? <Notice tone="success">{result.message}</Notice> : null}
      {result && !result.ok ? <ErrorSummary message={result.message} /> : null}

      <Panel title="Details">
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(8rem, max-content) 1fr",
            gap: "var(--space-2) var(--space-4)",
          }}
        >
          {rows.map(([k, v]) =>
            v ? (
              <div key={k} style={{ display: "contents" }}>
                <dt className="muted">{k}</dt>
                <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{v}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <h3 style={{ fontSize: "var(--text-base)" }}>Message</h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{e.message}</p>
      </Panel>

      {loaderData.canEdit ? (
        <Panel title="Update">
          {loaderData.transitions.length > 0 ? (
            <Form method="post" className="stack" style={{ maxWidth: "32rem" }}>
              <input type="hidden" name="intent" value="status" />
              <label style={{ display: "grid", gap: "var(--space-1)", fontSize: "var(--text-sm)" }}>
                Move to
                <select
                  name="status"
                  required
                  defaultValue=""
                  style={{ minHeight: "2.75rem", padding: "0 var(--space-3)" }}
                >
                  <option value="" disabled>
                    Choose a status
                  </option>
                  {loaderData.transitions.map((s) => (
                    <option key={s} value={s}>
                      {ENQUIRY_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <TextArea name="note" label="Note" rows={3} maxLength={2000} />
              <Button busy={busy}>Update status</Button>
            </Form>
          ) : null}
          <Form method="post" className="stack" style={{ maxWidth: "32rem" }}>
            <input type="hidden" name="intent" value="note" />
            <TextArea name="note" label="Add an internal note" rows={3} maxLength={2000} required />
            <Button variant="secondary" busy={busy}>
              Add note
            </Button>
          </Form>
        </Panel>
      ) : null}

      <Panel title="Timeline">
        <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--space-3)" }}>
          {events.map((ev) => (
            <li
              key={ev.id}
              style={{
                borderLeft: "2px solid var(--color-line-strong)",
                paddingLeft: "var(--space-3)",
              }}
            >
              <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                {formatDateTime(ev.createdAt)}
              </p>
              <p>
                {ev.type === "status_change"
                  ? `Status: ${ENQUIRY_STATUS_LABELS[ev.fromStatus as EnquiryStatus] ?? ev.fromStatus} → ${ENQUIRY_STATUS_LABELS[ev.toStatus as EnquiryStatus] ?? ev.toStatus}`
                  : ev.type === "received"
                    ? "Enquiry received"
                    : ev.type === "note"
                      ? "Note"
                      : ev.type}
              </p>
              {ev.body ? <p style={{ whiteSpace: "pre-wrap" }}>{ev.body}</p> : null}
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}
