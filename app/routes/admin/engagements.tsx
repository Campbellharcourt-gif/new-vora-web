import { ENGAGEMENT_STATUS_LABELS, ENGAGEMENT_STATUSES } from "@shared/enums";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { actionError, load, requirePermission } from "~/.server/guards";
import { listClients, listEngagements, saveEngagement } from "~/.server/services/engagements";
import { Button, ErrorSummary, FormScope, Select, TextField } from "~/components/ui/forms";
import { EngagementStatusTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/engagements";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "engagements.view");
  const { server } = load(context);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.slice(0, 80) ?? "";
  const status = url.searchParams.get("status") ?? "";
  const canCreate =
    actor.permissions.has("clients.manage") && actor.permissions.has("engagements.manage");
  const [items, clients] = await Promise.all([
    listEngagements(server, actor, { q, status }),
    canCreate ? listClients(server, actor) : Promise.resolve([]),
  ]);
  return {
    items,
    q,
    status,
    canCreate,
    clients: clients.map((c) => ({ key: c.id, label: c.name })),
    scopedToAssigned: actor.rank < 60,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "engagements.manage");
  const form = await request.formData();
  try {
    const id = await saveEngagement(load(context).server, actor, null, {
      ...Object.fromEntries(form),
      status: "planning",
    });
    return redirect(`/admin/engagements/${id}?created=1`);
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Client projects — Admin — VORA" }];
}

export default function Engagements({ loaderData }: Route.ComponentProps) {
  const { items, q, status, canCreate, clients, scopedToAssigned } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  return (
    <>
      <PageHeading
        eyebrow="Clients"
        title="Client projects"
        description={
          scopedToAssigned
            ? "The client projects you're assigned to."
            : "Every client project: team, services, milestones, updates and files."
        }
      />
      <Form method="get" className="v-filters" aria-label="Filter projects">
        <div className="v-field">
          <label className="v-label" htmlFor="eng-q">
            Search
          </label>
          <input id="eng-q" name="q" type="search" className="v-input" defaultValue={q} />
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="eng-status">
            Status
          </label>
          <span className="v-selectwrap">
            <select id="eng-status" name="status" className="v-select" defaultValue={status}>
              <option value="">All statuses</option>
              {ENGAGEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ENGAGEMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </span>
        </div>
        <button type="submit" className="v-btn v-btn--secondary v-btn--s">
          Filter
        </button>
      </Form>

      <Panel flush>
        {items.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">
              {q || status
                ? "No projects match."
                : scopedToAssigned
                  ? "You aren't assigned to any client projects yet."
                  : "No client projects yet."}
            </p>
          </div>
        ) : (
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Client projects</caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Client</th>
                  <th scope="col">Status</th>
                  <th scope="col">Target</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link to={`/admin/engagements/${e.id}`}>{e.name}</Link>
                    </td>
                    <td data-label="Client">{e.orgName}</td>
                    <td data-label="Status">
                      <EngagementStatusTag status={e.status} />
                    </td>
                    <td data-label="Target" className="v-data">
                      {e.targetDate ?? "—"}
                    </td>
                    <td data-label="Updated" className="v-data">
                      {formatDateTime(e.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {canCreate ? (
        <Panel title="New client project">
          {clients.length === 0 ? (
            <p className="v-body-s">
              Create the <Link to="/admin/clients">client</Link> first.
            </p>
          ) : (
            <>
              {result && !result.ok ? (
                <ErrorSummary message={result.message} fields={result.fields} />
              ) : null}
              <FormScope prefix="new-engagement">
                <Form method="post" className="v-form v-form--tight">
                  <Select
                    name="orgId"
                    label="Client"
                    required
                    options={clients}
                    error={result && !result.ok ? result.fields.orgId : undefined}
                  />
                  <TextField
                    name="name"
                    label="Project name"
                    required
                    maxLength={160}
                    error={result && !result.ok ? result.fields.name : undefined}
                  />
                  <TextField name="startDate" label="Start date" type="date" />
                  <TextField name="targetDate" label="Target date" type="date" />
                  <div>
                    <Button busy={busy} size="s">
                      Create project
                    </Button>
                  </div>
                </Form>
              </FormScope>
            </>
          )}
        </Panel>
      ) : null}
    </>
  );
}
