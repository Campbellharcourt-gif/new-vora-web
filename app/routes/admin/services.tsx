import { load, requirePermission } from "~/.server/guards";
import { listAdminServices } from "~/.server/services/admin-workspace";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/services";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { items: await listAdminServices(load(context).server, await requirePermission(context, request, "services.view")) };
}

export default function Services({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Services" description="Manage the studio capability catalogue and its publication state." />
      <Panel title="Services" flush>
        {loaderData.items.length === 0 ? <div className="v-panel__body"><p className="v-body">No services yet.</p></div> : (
          <div className="v-tablewrap"><table className="v-table v-table--stack">
            <caption className="v-sr">Services</caption>
            <thead><tr><th>Service</th><th>Delivery</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{loaderData.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong>{item.summary ? <div className="v-body-s">{item.summary}</div> : null}</td>
                <td data-label="Delivery">{item.deliveryModel}</td>
                <td data-label="Status">{item.status}{item.hasUnpublishedChanges ? " · draft changes" : ""}</td>
                <td data-label="Updated" className="v-data">{formatDateTime(item.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
