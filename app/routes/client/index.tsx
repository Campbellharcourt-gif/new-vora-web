import { load, requirePermission } from "~/.server/guards";
import { listClientEngagements } from "~/.server/services/client-portal";
import { StatusIndicator } from "~/components/vora/primitives";
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
      <PageHeading eyebrow="Client portal" title="Your engagements" />
      <WelcomeNotice>
        Welcome to VORA. Your projects appear here once your VORA contact links your account to your
        organisation.
      </WelcomeNotice>
      {loaderData.engagements.length === 0 ? (
        <EmptyState>
          There are no engagements shared with you yet. Your VORA contact will add them here.
        </EmptyState>
      ) : (
        <Panel title="Engagements" flush>
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Your engagements</caption>
              <thead>
                <tr>
                  <th scope="col">Engagement</th>
                  <th scope="col">Organisation</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.engagements.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td data-label="Organisation">{e.orgName}</td>
                    <td data-label="Status">
                      <StatusIndicator kind="info">{e.status.replace("_", " ")}</StatusIndicator>
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
