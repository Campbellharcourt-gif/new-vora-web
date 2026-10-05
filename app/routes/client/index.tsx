import { Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { listClientEngagements } from "~/.server/services/client-portal";
import { EngagementStatusTag } from "~/components/workspace/status";
import {
  EmptyState,
  PageHeading,
  Panel,
  WelcomeNotice,
} from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/index";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "client_portal.access");
  return { engagements: await listClientEngagements(load(context).server, actor) };
}

export default function ClientHome({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Client portal" title="Your projects" />
      <WelcomeNotice>
        Welcome to VORA. Your projects appear here once your VORA contact links your account to your
        organisation.
      </WelcomeNotice>
      {loaderData.engagements.length === 0 ? (
        <EmptyState>
          There are no projects shared with you yet. Your VORA contact will add them here.
        </EmptyState>
      ) : (
        <Panel title="Projects" flush>
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Your projects</caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Organisation</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.engagements.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link to={`/client/projects/${e.id}`}>{e.name}</Link>
                    </td>
                    <td data-label="Organisation">{e.orgName}</td>
                    <td data-label="Status">
                      <EngagementStatusTag status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
