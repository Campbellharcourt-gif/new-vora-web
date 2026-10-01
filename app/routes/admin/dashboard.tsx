import { ENQUIRY_STATUSES } from "@shared/enums";
import { Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { adminOverview } from "~/.server/services/admin-workspace";
import { enquiryCounts } from "~/.server/services/enquiries";
import { EnquiryStatusTag } from "~/components/workspace/status";
import { EmptyState, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/dashboard";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  const server = load(context).server;
  const [overview, enquiries] = await Promise.all([
    adminOverview(server, actor),
    actor.permissions.has("enquiries.view") ? enquiryCounts(server, actor) : Promise.resolve(null),
  ]);
  return { name: actor.name, counts: overview.counts, enquiries };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { counts, enquiries } = loaderData;
  const modules = [
    ["Clients", counts.clients, "/admin/clients"],
    ["Projects", counts.projects, "/admin/projects"],
    ["Services", counts.services, "/admin/services"],
    ["Pages", counts.pages, "/admin/content"],
    ["Enquiries", counts.enquiries, "/admin/enquiries"],
    ["Users", counts.users, "/admin/users"],
  ] as const;
  return (
    <>
      <PageHeading eyebrow="Admin" title={`Welcome, ${loaderData.name.split(" ")[0]}`} description="The VORA operating workspace." />
      <div className="v-panels v-panels--three">
        {modules.map(([label, value, to]) => (
          <Panel key={label} title={label}>
            <p className="v-display-m">{value ?? "—"}</p>
            <Link className="v-arrowlink" to={to}><span>Open</span></Link>
          </Panel>
        ))}
      </div>
      {enquiries ? (
        <Panel title="Enquiry pipeline" flush actions={<Link className="v-link v-body-s" to="/admin/enquiries">View all</Link>}>
          <div className="v-panel__body"><p className="v-body-s"><strong className="v-data">{enquiries.last7Days}</strong> received in the last 7 days.</p></div>
          <div className="v-tablewrap">
            <table className="v-table">
              <caption className="v-sr">Enquiries by status</caption>
              <thead><tr><th>Status</th><th className="num">Count</th></tr></thead>
              <tbody>{ENQUIRY_STATUSES.map((status) => (
                <tr key={status}>
                  <td><Link to={`/admin/enquiries?status=${status}`} style={{ textDecoration: "none", color: "inherit" }}><EnquiryStatusTag status={status} /></Link></td>
                  <td className="num">{enquiries.byStatus[status] ?? 0}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      ) : <EmptyState>Your role doesn't include enquiry access. Available modules appear in the navigation.</EmptyState>}
    </>
  );
}
