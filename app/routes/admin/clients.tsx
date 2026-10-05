import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { actionError, load, requirePermission } from "~/.server/guards";
import { listClients, saveClient, unlinkedClientAccounts } from "~/.server/services/engagements";
import { Button, ErrorSummary, FormScope, TextField } from "~/components/ui/forms";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/clients";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "clients.view");
  const { server } = load(context);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.slice(0, 80) ?? "";
  const archived = url.searchParams.get("archived") === "1";
  const [clients, unlinked] = await Promise.all([
    listClients(server, actor, { q, status: archived ? "archived" : "active" }),
    unlinkedClientAccounts(server, actor),
  ]);
  return { clients, unlinked, q, archived, canManage: actor.permissions.has("clients.manage") };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "clients.manage");
  const form = await request.formData();
  try {
    const id = await saveClient(load(context).server, actor, null, Object.fromEntries(form));
    return redirect(`/admin/clients/${id}?created=1`);
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Clients — Admin — VORA" }];
}

export default function Clients({ loaderData }: Route.ComponentProps) {
  const { clients, unlinked, q, archived, canManage } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  return (
    <>
      <PageHeading
        eyebrow="Clients"
        title="Clients"
        description="Client organisations, the people who can see their projects, and their projects."
      />
      <Form method="get" className="v-filters" aria-label="Search clients">
        <div className="v-field">
          <label className="v-label" htmlFor="clients-q">
            Search
          </label>
          <input id="clients-q" name="q" type="search" className="v-input" defaultValue={q} />
        </div>
        {archived ? <input type="hidden" name="archived" value="1" /> : null}
        <button type="submit" className="v-btn v-btn--secondary v-btn--s">
          Search
        </button>
        <Link
          className="v-link v-body-s"
          to={archived ? "/admin/clients" : "/admin/clients?archived=1"}
        >
          {archived ? "Show active" : "Show archived"}
        </Link>
      </Form>

      <Panel title={archived ? "Archived clients" : "Clients"} flush>
        {clients.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">{q ? "No client matches that search." : "No clients yet."}</p>
          </div>
        ) : (
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Clients</caption>
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col" className="num">
                    Projects
                  </th>
                  <th scope="col" className="num">
                    People
                  </th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/clients/${c.id}`}>{c.name}</Link>
                    </td>
                    <td data-label="Projects" className="num">
                      {c.engagements}
                    </td>
                    <td data-label="People" className="num">
                      {c.members}
                    </td>
                    <td data-label="Since" className="v-data">
                      {formatDateTime(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="v-panels">
        {unlinked.length > 0 ? (
          <Panel title="Client accounts waiting for access" flush>
            <div className="v-panel__body">
              <p className="v-body-s">
                These people have Client accounts but aren't linked to an organisation, so their
                portal is empty. Open a client and add them by email.
              </p>
            </div>
            <ul className="v-list">
              {unlinked.map((u) => (
                <li key={u.id}>
                  {u.name} <span className="v-body-s v-secondary">· {u.email}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {canManage && !archived ? (
          <Panel title="New client">
            {result && !result.ok ? (
              <ErrorSummary message={result.message} fields={result.fields} />
            ) : null}
            <FormScope prefix="new-client">
              <Form method="post" className="v-form v-form--tight">
                <TextField
                  name="name"
                  label="Organisation name"
                  required
                  maxLength={160}
                  error={result && !result.ok ? result.fields.name : undefined}
                />
                <TextField
                  name="websiteUrl"
                  label="Website"
                  type="url"
                  error={result && !result.ok ? result.fields.websiteUrl : undefined}
                />
                <div>
                  <Button busy={busy} size="s">
                    Create client
                  </Button>
                </div>
              </Form>
            </FormScope>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
