import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import { handlePrivacyRequest, listPrivacyRequests } from "~/.server/services/privacy";
import { Button, ErrorSummary, Notice, TextField } from "~/components/ui/forms";
import { StatusIndicator, type StatusKind } from "~/components/vora/primitives";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/privacy";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "privacy.manage");
  const all = new URL(request.url).searchParams.get("all") === "1";
  return {
    requests: await listPrivacyRequests(load(context).server, actor, { open: !all }),
    all,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "privacy.manage");
  const form = await request.formData();
  const action = formString(form, "action");
  if (action !== "start" && action !== "complete" && action !== "reject") {
    return data(
      { ok: false as const, message: "Unknown action.", fields: {} as Record<string, string> },
      { status: 400 },
    );
  }
  try {
    await handlePrivacyRequest(load(context).server, actor, formString(form, "id"), {
      action,
      note: formString(form, "note"),
    });
    return {
      ok: true as const,
      message: action === "complete" ? "Done. The person has been emailed." : "Request updated.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Privacy requests — Admin — VORA" }];
}

const KIND: Record<string, StatusKind> = {
  received: "warn",
  in_progress: "info",
  completed: "ok",
  rejected: "muted",
};

export default function PrivacyRequests({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Privacy requests"
        description="Account deletion requests, and a record of data downloads. Completing a deletion signs the person out, removes their access and replaces their name and email; audit history is kept."
        actions={
          <Link className="v-link v-body-s" to={loaderData.all ? "/admin/privacy" : "?all=1"}>
            {loaderData.all ? "Show open only" : "Show all"}
          </Link>
        }
      />
      {result?.ok ? (
        <Notice tone="success" label="Done">
          {result.message}
        </Notice>
      ) : null}
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}

      {loaderData.requests.length === 0 ? (
        <Panel>
          <p className="v-body">{loaderData.all ? "No requests yet." : "No open requests."}</p>
        </Panel>
      ) : (
        loaderData.requests.map((r) => (
          <Panel
            key={r.id}
            title={`${r.type === "delete" ? "Account deletion" : "Data download"} — ${r.name ?? r.email}`}
            actions={
              <StatusIndicator kind={KIND[r.status] ?? "muted"}>
                {r.status.replace("_", " ")}
              </StatusIndicator>
            }
          >
            <p className="v-body-s">
              {r.email} · requested {formatDateTime(r.requestedAt)}
              {r.completedAt ? ` · closed ${formatDateTime(r.completedAt)}` : ""}
              {r.userId ? (
                <>
                  {" · "}
                  <Link className="v-link" to={`/admin/users/${r.userId}`}>
                    Open user
                  </Link>
                </>
              ) : null}
            </p>
            {r.notes ? <p className="v-message v-body-s">{r.notes}</p> : null}
            {r.type === "delete" && (r.status === "received" || r.status === "in_progress") ? (
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="id" value={r.id} />
                <TextField
                  name="note"
                  label="Note to keep (and to send if you decline)"
                  maxLength={1000}
                />
                <div className="v-actions">
                  {r.status === "received" ? (
                    <Button variant="secondary" size="s" name="action" value="start" busy={busy}>
                      Mark in progress
                    </Button>
                  ) : null}
                  <Button variant="danger" size="s" name="action" value="complete" busy={busy}>
                    Delete the account
                  </Button>
                  <Button variant="quiet" size="s" name="action" value="reject" busy={busy}>
                    Decline
                  </Button>
                </div>
              </Form>
            ) : null}
          </Panel>
        ))
      )}
    </>
  );
}
