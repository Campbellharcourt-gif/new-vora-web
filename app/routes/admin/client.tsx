import { ENGAGEMENT_STATUS_LABELS, type EngagementStatus } from "@shared/enums";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { actionError, failureFrom, formString, load, requirePermission } from "~/.server/guards";
import {
  getClient,
  linkClientUser,
  saveClient,
  saveEngagement,
  unlinkClientUser,
} from "~/.server/services/engagements";
import { Button, ErrorSummary, FormScope, Notice, Select, TextField } from "~/components/ui/forms";
import { StatusIndicator } from "~/components/vora/primitives";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/client";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "clients.view");
  const detail = await getClient(load(context).server, actor, params.id).catch((error) => {
    failureFrom(error);
    throw error;
  });
  return {
    ...detail,
    canManage: actor.permissions.has("clients.manage"),
    canCreateProject:
      actor.permissions.has("clients.manage") && actor.permissions.has("engagements.manage"),
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "clients.manage");
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  try {
    switch (intent) {
      case "save":
        await saveClient(server, actor, params.id, Object.fromEntries(form));
        return { ok: true as const, intent, message: "Client saved." };
      case "link":
        await linkClientUser(server, actor, params.id, {
          email: formString(form, "email"),
          orgRole: formString(form, "orgRole"),
        });
        return { ok: true as const, intent, message: "Access granted. They've been notified." };
      case "unlink":
        await unlinkClientUser(server, actor, params.id, formString(form, "userId"));
        return { ok: true as const, intent, message: "Access removed." };
      case "project": {
        const id = await saveEngagement(server, actor, null, {
          ...Object.fromEntries(form),
          orgId: params.id,
        });
        return redirect(`/admin/engagements/${id}?created=1`);
      }
      default:
        return data(
          {
            ok: false as const,
            intent,
            message: "Unknown action.",
            fields: {} as Record<string, string>,
          },
          { status: 400 },
        );
    }
  } catch (error) {
    const failure = actionError(error);
    return data({ ...failure.data, intent }, failure.init ?? undefined);
  }
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${loaderData?.org.name ?? "Client"} — Admin — VORA` }];
}

const ORG_ROLE_OPTIONS = [
  { key: "member", label: "Member — sees projects, files and updates" },
  { key: "owner", label: "Owner — the main contact" },
  { key: "viewer", label: "Viewer — read only" },
];

export default function ClientDetail({ loaderData }: Route.ComponentProps) {
  const { org, members, engagements, activity, canManage, canCreateProject } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const [params] = useSearchParams();
  const feedback = (intent: string) =>
    result && result.intent === intent ? (
      result.ok ? (
        <Notice tone="success" label="Saved">
          {result.message}
        </Notice>
      ) : (
        <ErrorSummary message={result.message} fields={result.fields} />
      )
    ) : null;
  const fieldError = (intent: string, name: string) =>
    result && !result.ok && result.intent === intent ? result.fields[name] : undefined;

  return (
    <>
      <PageHeading
        title={org.name}
        crumbs={[{ to: "/admin/clients", label: "Clients" }]}
        actions={
          <StatusIndicator kind={org.status === "active" ? "ok" : "muted"}>
            {org.status === "active" ? "Active" : "Archived"}
          </StatusIndicator>
        }
      />
      {params.get("created") === "1" && !result ? (
        <Notice tone="success" label="Created">
          Client created. Add the people who should see its projects, then create a project.
        </Notice>
      ) : null}

      <div className="v-panels v-panels--detail">
        <div className="v-stack" style={{ gap: "var(--space-5)" }}>
          <Panel title="Projects" flush>
            {engagements.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">No projects for this client yet.</p>
              </div>
            ) : (
              <div className="v-tablewrap">
                <table className="v-table v-table--stack">
                  <caption className="v-sr">Projects for {org.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col">Status</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {engagements.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <Link to={`/admin/engagements/${e.id}`}>{e.name}</Link>
                        </td>
                        <td data-label="Status">
                          {ENGAGEMENT_STATUS_LABELS[e.status as EngagementStatus] ?? e.status}
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
            {canCreateProject && org.status === "active" ? (
              <div className="v-panel__body">
                <details className="v-disclosure">
                  <summary>New project for {org.name}</summary>
                  {feedback("project")}
                  <FormScope prefix="new-project">
                    <Form method="post" className="v-form v-form--tight">
                      <input type="hidden" name="intent" value="project" />
                      <input type="hidden" name="status" value="planning" />
                      <TextField
                        name="name"
                        label="Project name"
                        required
                        maxLength={160}
                        error={fieldError("project", "name")}
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
                </details>
              </div>
            ) : null}
          </Panel>

          <Panel title="People with access" flush>
            <div className="v-panel__body">
              <p className="v-body-s">
                Client accounts linked here see this client's projects, shared files and updates in
                their portal — nothing else.
              </p>
              {feedback("link")}
              {feedback("unlink")}
            </div>
            {members.length > 0 ? (
              <ul className="v-list">
                {members.map((m) => (
                  <li key={m.userId}>
                    <span>
                      {m.name} <span className="v-secondary">· {m.email}</span>
                      <span className="v-secondary">
                        {" "}
                        · {m.orgRole}
                        {m.status !== "active" ? ` · ${m.status}` : ""}
                      </span>
                    </span>
                    {canManage ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="unlink" />
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button variant="quiet" size="s" busy={busy}>
                          Remove<span className="v-sr"> {m.name}</span>
                        </Button>
                      </Form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canManage ? (
              <div className="v-panel__body">
                <FormScope prefix="link-client">
                  <Form method="post" className="v-form v-form--tight">
                    <input type="hidden" name="intent" value="link" />
                    <TextField
                      name="email"
                      label="Add a person by email"
                      type="email"
                      hint="They need a Client account (invited, or created from the sign-in page)."
                      error={fieldError("link", "email")}
                    />
                    <Select
                      name="orgRole"
                      label="Their role here"
                      options={ORG_ROLE_OPTIONS}
                      defaultValue="member"
                    />
                    <div>
                      <Button variant="secondary" size="s" busy={busy}>
                        Give access
                      </Button>
                    </div>
                  </Form>
                </FormScope>
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="v-panels__aside">
          {canManage ? (
            <Panel title="Details">
              {feedback("save")}
              <FormScope prefix="client">
                <Form method="post" className="v-form v-form--tight">
                  <input type="hidden" name="intent" value="save" />
                  <TextField
                    name="name"
                    label="Organisation name"
                    required
                    maxLength={160}
                    defaultValue={org.name}
                    error={fieldError("save", "name")}
                  />
                  <TextField
                    name="slug"
                    label="Short name"
                    maxLength={80}
                    defaultValue={org.slug}
                    error={fieldError("save", "slug")}
                  />
                  <TextField
                    name="websiteUrl"
                    label="Website"
                    type="url"
                    defaultValue={org.websiteUrl ?? ""}
                    error={fieldError("save", "websiteUrl")}
                  />
                  <Select
                    name="status"
                    label="Status"
                    required
                    options={[
                      { key: "active", label: "Active" },
                      { key: "archived", label: "Archived" },
                    ]}
                    defaultValue={org.status}
                  />
                  <div>
                    <Button busy={busy} size="s">
                      Save
                    </Button>
                  </div>
                </Form>
              </FormScope>
            </Panel>
          ) : (
            <Panel title="Details">
              <dl className="v-dl">
                <dt>Website</dt>
                <dd>{org.websiteUrl ?? "—"}</dd>
              </dl>
            </Panel>
          )}
          {activity.length > 0 ? (
            <Panel title="Activity">
              <ol className="v-timeline">
                {activity.map((a) => (
                  <li key={a.id}>
                    <span className="v-data v-secondary">{formatDateTime(a.createdAt)}</span>
                    <span>
                      {a.summary}
                      {a.actorName ? <span className="v-secondary"> · {a.actorName}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
