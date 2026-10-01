import { load, requirePermission } from "~/.server/guards";
import { listAuditLogs } from "~/.server/services/admin-workspace";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/audit";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { entries: await listAuditLogs(load(context).server, await requirePermission(context, request, "audit.view")) };
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Audit Log" description="Append-only record of administrative and security-sensitive changes." />
      <Panel title="Recent activity" flush>
        {loaderData.entries.length === 0 ? <div className="v-panel__body"><p className="v-body">No audit entries yet.</p></div> : (
          <div className="v-tablewrap"><table className="v-table v-table--stack">
            <caption className="v-sr">Audit log</caption>
            <thead><tr><th>Time</th><th>Action</th><th>Target</th><th>Summary</th><th>Actor</th></tr></thead>
            <tbody>{loaderData.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="v-data" data-label="Time">{formatDateTime(entry.createdAt)}</td>
                <td data-label="Action">{entry.action}</td>
                <td data-label="Target">{entry.targetType ? [entry.targetType, entry.targetId].filter(Boolean).join(" · ") : "—"}</td>
                <td data-label="Summary">{entry.summary}</td>
                <td data-label="Actor">{entry.actorUserId ?? "System"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
