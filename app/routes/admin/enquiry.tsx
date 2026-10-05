import {
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_STATUSES,
  ENQUIRY_TRANSITIONS,
  type EnquiryStatus,
} from "@shared/enums";
import { data, Form, useActionData, useNavigation } from "react-router";
import { adminAiAvailable, summariseEnquiry } from "~/.server/ai/admin-tools";
import { failureFrom, formString, load, requirePermission } from "~/.server/guards";
import {
  addEnquiryNote,
  assignEnquiry,
  changeEnquiryStatus,
  enquiryAssignees,
  getEnquiry,
} from "~/.server/services/enquiries";
import { Button, ErrorSummary, Notice, Select, TextArea } from "~/components/ui/forms";
import { EnquiryStatusTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/enquiry";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "enquiries.view");
  const { server } = load(context);
  const { enquiry, events, assignee } = await getEnquiry(server, actor, params.id).catch(
    (error) => {
      failureFrom(error);
      throw error;
    },
  );
  const canEdit = actor.permissions.has("enquiries.edit");
  return {
    enquiry,
    events,
    assignee,
    assignees: canEdit ? await enquiryAssignees(server) : [],
    aiAvailable: await adminAiAvailable(server, actor),
    canEdit,
    transitions: ENQUIRY_TRANSITIONS[enquiry.status],
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const { server } = load(context);
  const form = await request.formData();
  if (formString(form, "intent") === "ai-summary") {
    const viewer = await requirePermission(context, request, "ai.use");
    try {
      const summary = await summariseEnquiry(server, viewer, params.id);
      return { ok: true as const, message: "", aiSummary: summary };
    } catch (error) {
      const failure = failureFrom(error);
      return data(
        { ok: false as const, message: failure.message, fields: failure.fields, ai: true },
        { status: failure.status },
      );
    }
  }
  const actor = await requirePermission(context, request, "enquiries.edit");
  try {
    if (formString(form, "intent") === "note") {
      await addEnquiryNote(server, actor, params.id, formString(form, "note"));
      return { ok: true as const, message: "Note added." };
    }
    if (formString(form, "intent") === "assign") {
      const assignee = formString(form, "assignee") || null;
      await assignEnquiry(server, actor, params.id, assignee);
      return { ok: true as const, message: assignee ? "Assigned." : "Unassigned." };
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
        title={e.reference}
        crumbs={[{ to: "/admin/enquiries", label: "Enquiries" }]}
        actions={<EnquiryStatusTag status={e.status} />}
      />
      <p className="v-body-s">Received {formatDateTime(e.createdAt)}</p>
      {result?.ok && !("aiSummary" in result) ? (
        <Notice tone="success" label="Saved">
          {result.message}
        </Notice>
      ) : null}
      {result && !result.ok && !("ai" in result) ? <ErrorSummary message={result.message} /> : null}

      <div className="v-panels v-panels--detail">
        <Panel title="Details">
          <dl className="v-dl">
            {rows.map(([k, v]) =>
              v ? (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ) : null,
            )}
          </dl>
          <h3 className="v-label" style={{ marginTop: "var(--space-3)" }}>
            Message
          </h3>
          <p className="v-message">{e.message}</p>
        </Panel>

        <div className="v-panels__aside">
          {loaderData.aiAvailable ? (
            <Panel title="VORA AI">
              {result && "aiSummary" in result && result.aiSummary ? (
                <div className="v-stack" style={{ gap: "var(--space-2)" }}>
                  <p className="v-message v-body-s">{result.aiSummary}</p>
                  <p className="v-body-s v-secondary">
                    AI-written summary — check it against the enquiry.
                  </p>
                </div>
              ) : null}
              {result && !result.ok && "ai" in result ? (
                <Notice tone="warning" label="VORA AI">
                  {result.message}
                </Notice>
              ) : null}
              <Form method="post">
                <input type="hidden" name="intent" value="ai-summary" />
                <Button variant="secondary" size="s" busy={busy}>
                  Summarise this enquiry
                </Button>
              </Form>
            </Panel>
          ) : null}

          <Panel title="Assigned to">
            {loaderData.canEdit ? (
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="assign" />
                <Select
                  name="assignee"
                  label="Team member"
                  options={loaderData.assignees.map((a) => ({ key: a.id, label: a.name }))}
                  defaultValue={loaderData.assignee?.id ?? ""}
                  placeholder="Unassigned"
                />
                <div>
                  <Button variant="secondary" size="s" busy={busy}>
                    Save assignment
                  </Button>
                </div>
              </Form>
            ) : (
              <p className="v-body">{loaderData.assignee?.name ?? "Unassigned"}</p>
            )}
          </Panel>

          {loaderData.canEdit ? (
            <Panel title="Update">
              {loaderData.transitions.length > 0 ? (
                <Form method="post" className="v-form v-form--tight">
                  <input type="hidden" name="intent" value="status" />
                  <div className="v-field">
                    <label className="v-field__label" htmlFor="enquiry-status">
                      Move to
                    </label>
                    <span className="v-selectwrap">
                      <select
                        id="enquiry-status"
                        name="status"
                        required
                        defaultValue=""
                        className="v-select"
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
                    </span>
                  </div>
                  <TextArea name="note" label="Note" rows={3} maxLength={2000} />
                  <div>
                    <Button busy={busy} size="s">
                      Update status
                    </Button>
                  </div>
                </Form>
              ) : null}
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="note" />
                <TextArea
                  name="note"
                  label="Add an internal note"
                  rows={3}
                  maxLength={2000}
                  required
                />
                <div>
                  <Button variant="secondary" size="s" busy={busy}>
                    Add note
                  </Button>
                </div>
              </Form>
            </Panel>
          ) : null}

          <Panel title="Timeline">
            <ol className="v-timeline">
              {events.map((ev) => (
                <li key={ev.id}>
                  <span className="v-data v-secondary">{formatDateTime(ev.createdAt)}</span>
                  <span>
                    {ev.type === "status_change"
                      ? `Status: ${ENQUIRY_STATUS_LABELS[ev.fromStatus as EnquiryStatus] ?? ev.fromStatus} → ${ENQUIRY_STATUS_LABELS[ev.toStatus as EnquiryStatus] ?? ev.toStatus}`
                      : ev.type === "received"
                        ? "Enquiry received"
                        : ev.type === "note"
                          ? "Note"
                          : ev.type === "assignment"
                            ? "Assignment"
                            : ev.type}
                    {ev.actorName ? <span className="v-secondary"> · {ev.actorName}</span> : null}
                  </span>
                  {ev.body ? <p className="v-message v-body-s">{ev.body}</p> : null}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
