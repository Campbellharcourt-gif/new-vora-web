import { Form, useActionData, useNavigation } from "react-router";
import { failureFrom, formString, load, requirePermission } from "~/.server/guards";
import { getClientEngagement, postClientMessage } from "~/.server/services/client-portal";
import { Button, ErrorSummary, Notice, TextArea } from "~/components/ui/forms";
import { EngagementStatusTag, MilestoneStatusTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/project";

/** One project in the client portal. Only this client's own data reaches the page. */
export async function loader({ context, request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "client_portal.access");
  return getClientEngagement(load(context).server, actor, params.id).catch((error) => {
    failureFrom(error);
    throw error;
  });
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "client_portal.access");
  const form = await request.formData();
  try {
    await postClientMessage(load(context).server, actor, params.id, formString(form, "body"));
    return { ok: true as const, message: "Sent. The VORA team has been notified." };
  } catch (error) {
    const failure = failureFrom(error);
    return { ok: false as const, message: failure.message, fields: failure.fields };
  }
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${loaderData?.engagement.name ?? "Project"} — VORA` }];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ClientProject({ loaderData }: Route.ComponentProps) {
  const { engagement: e, services, milestones, updates, files, team } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  return (
    <>
      <PageHeading
        title={e.name}
        crumbs={[{ to: "/client", label: "Projects" }]}
        actions={<EngagementStatusTag status={e.status} />}
      />
      <p className="v-body-s">
        {e.orgName} · updated {formatDateTime(e.updatedAt)}
      </p>

      <div className="v-panels v-panels--detail">
        <div className="v-stack" style={{ gap: "var(--space-5)" }}>
          <Panel title="Overview">
            <dl className="v-dl">
              {e.summary ? (
                <>
                  <dt>Summary</dt>
                  <dd>{e.summary}</dd>
                </>
              ) : null}
              <dt>Services</dt>
              <dd>{services.length > 0 ? services.join(", ") : "—"}</dd>
              <dt>Start</dt>
              <dd className="v-data">{e.startDate ?? "—"}</dd>
              <dt>Target</dt>
              <dd className="v-data">{e.targetDate ?? "—"}</dd>
              <dt>Team</dt>
              <dd>{team.length > 0 ? team.join(", ") : "—"}</dd>
            </dl>
          </Panel>

          <Panel title="Updates">
            {result?.ok ? (
              <Notice tone="success" label="Sent">
                {result.message}
              </Notice>
            ) : null}
            {result && !result.ok ? (
              <ErrorSummary message={result.message} fields={result.fields} />
            ) : null}
            <Form method="post" className="v-form v-form--tight">
              <TextArea
                name="body"
                label="Message the VORA team"
                rows={3}
                maxLength={5000}
                required
                error={result && !result.ok ? result.fields.body : undefined}
              />
              <div>
                <Button size="s" busy={busy}>
                  Send
                </Button>
              </div>
            </Form>
            {updates.length === 0 ? (
              <p className="v-body-s">No updates yet.</p>
            ) : (
              <ol className="v-timeline">
                {updates.map((u) => (
                  <li key={u.id}>
                    <span className="v-data v-secondary">
                      {formatDateTime(u.createdAt)} ·{" "}
                      {u.fromClient ? "You" : (u.authorName ?? "VORA")}
                    </span>
                    <p className="v-message">{u.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="v-panels__aside">
          <Panel title="Milestones" flush>
            {milestones.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">Milestones appear here once planned.</p>
              </div>
            ) : (
              <ul className="v-list">
                {milestones.map((m) => (
                  <li key={m.id}>
                    <span>
                      {m.title}
                      {m.dueDate ? <span className="v-secondary"> · {m.dueDate}</span> : null}
                    </span>
                    <MilestoneStatusTag status={m.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Files" flush>
            {files.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">Files shared with you appear here.</p>
              </div>
            ) : (
              <ul className="v-list">
                {files.map((f) => (
                  <li key={f.id}>
                    <a className="v-link" href={`/api/v1/files/${f.id}`} download>
                      {f.label}
                    </a>
                    <span className="v-secondary v-data">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
