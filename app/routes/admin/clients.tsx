import { Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { listAdminClients } from "~/.server/services/admin-workspace";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/clients";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { items: await listAdminClients(load(context).server, await requirePermission(context, request, "clients.view")) };
}

export default function Clients({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Clients" description="Client organisations and their active engagements." />
      <Panel title="Client organisations" flush>
        {loaderData.items.length === 0 ? (
          <div className="v-panel__body"><p className="v-body">No client organisations yet.</p></div>
        ) : (
          <div className="v-tablewrap"><table className="v-table v-table--stack">
            <caption className="v-sr">Client organisations</caption>
            <thead><tr><th>Name</th><th>Status</th><th>Engagements</th><th>Created</th></tr></thead>
            <tbody>{loaderData.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong>{item.websiteUrl ? <div className="v-body-s">{item.websiteUrl}</div> : null}</td>
                <td data-label="Status">{item.status}</td>
                <td data-label="Engagements" className="v-data">{item.engagements}</td>
                <td data-label="Created" className="v-data">{formatDateTime(item.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
