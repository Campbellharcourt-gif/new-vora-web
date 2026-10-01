import { Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { listAdminProjects } from "~/.server/services/admin-workspace";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/projects";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { items: await listAdminProjects(load(context).server, await requirePermission(context, request, "projects.view")) };
}

export default function Projects({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Projects" description="The working project archive. Public routes only read published versions." />
      <Panel title="Projects" flush>
        {loaderData.items.length === 0 ? <div className="v-panel__body"><p className="v-body">No projects yet.</p></div> : (
          <div className="v-tablewrap"><table className="v-table v-table--stack">
            <caption className="v-sr">Projects</caption>
            <thead><tr><th>Project</th><th>Status</th><th>Client</th><th>Year</th><th>Updated</th></tr></thead>
            <tbody>{loaderData.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.title}</strong><div className="v-body-s">{item.slug}</div></td>
                <td data-label="Status">{item.status}{item.hasUnpublishedChanges ? " · draft changes" : ""}</td>
                <td data-label="Client">{item.clientName ?? "—"}</td>
                <td data-label="Year" className="v-data">{item.year ?? "—"}</td>
                <td data-label="Updated" className="v-data">{formatDateTime(item.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
