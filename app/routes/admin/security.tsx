import { load, requirePermission } from "~/.server/guards";
import { listSecurityEvents } from "~/.server/services/admin-workspace";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/security";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { events: await listSecurityEvents(load(context).server, await requirePermission(context, request, "security.view")) };
}

export default function Security({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Security" description="Recent security-relevant events from the existing security event pipeline." />
      <Panel title="Security events" flush>
        {loaderData.events.length === 0 ? <div className="v-panel__body"><p className="v-body">No security events recorded.</p></div> : (
          <div className="v-tablewrap"><table className="v-table v-table--stack">
            <caption className="v-sr">Security events</caption>
            <thead><tr><th>Time</th><th>Severity</th><th>Event</th><th>User</th><th>Request</th></tr></thead>
            <tbody>{loaderData.events.map((event) => (
              <tr key={event.id}>
                <td className="v-data" data-label="Time">{formatDateTime(event.createdAt)}</td>
                <td data-label="Severity">{event.severity}</td>
                <td data-label="Event"><strong>{event.type}</strong></td>
                <td data-label="User">{event.userId ?? "—"}</td>
                <td className="v-data" data-label="Request">{event.requestId ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
