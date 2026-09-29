import { ENQUIRY_STATUSES } from "@shared/enums";
import { Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { enquiryCounts } from "~/.server/services/enquiries";
import { EnquiryStatusTag } from "~/components/workspace/status";
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
        <div className="v-panels v-panels--two">
          <Panel
            title="Enquiries"
            flush
            actions={
              <Link className="v-link v-body-s" to="/admin/enquiries">
                View all
              </Link>
            }
          >
            <div className="v-panel__body">
              <p className="v-body-s">
                <strong className="v-data">{counts.last7Days}</strong> received in the last 7 days.
              </p>
            </div>
            <div className="v-tablewrap">
              <table className="v-table">
                <caption className="v-sr">Enquiries by status</caption>
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ENQUIRY_STATUSES.map((status) => (
                    <tr key={status}>
                      <td>
                        <Link
                          to={`/admin/enquiries?status=${status}`}
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <EnquiryStatusTag status={status} />
                        </Link>
                      </td>
                      <td className="num">{counts.byStatus[status] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : (
        <EmptyState>
          Your role doesn't include enquiries. Modules you can use appear in the navigation.
        </EmptyState>
      )}
    </>
  );
}
