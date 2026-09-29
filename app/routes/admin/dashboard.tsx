import { ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES } from "@shared/enums";
import { Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { enquiryCounts } from "~/.server/services/enquiries";
import { EmptyState, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/dashboard";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  const counts = actor.permissions.has("enquiries.view")
    ? await enquiryCounts(load(context).server, actor)
    : null;
  return { name: actor.name, counts };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { counts } = loaderData;
  return (
    <>
      <PageHeading eyebrow="Admin" title={`Welcome, ${loaderData.name.split(" ")[0]}`} />
      {counts ? (
        <Panel title="Enquiries" actions={<Link to="/admin/enquiries">View all</Link>}>
          <p>
            <strong>{counts.last7Days}</strong> received in the last 7 days.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {ENQUIRY_STATUSES.map((status) => (
                <tr key={status}>
                  <td>
                    <Link to={`/admin/enquiries?status=${status}`}>
                      {ENQUIRY_STATUS_LABELS[status]}
                    </Link>
                  </td>
                  <td>{counts.byStatus[status] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : (
        <EmptyState>
          Your role doesn't include enquiries. Modules you can use appear in the navigation.
        </EmptyState>
      )}
    </>
  );
}
