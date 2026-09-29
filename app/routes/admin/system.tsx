import { load, requirePermission } from "~/.server/guards";
import { systemHealth } from "~/.server/services/health";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/system";

export async function loader({ context, request }: Route.LoaderArgs) {
  await requirePermission(context, request, "system.status");
  const { server } = load(context);
  const health = await systemHealth(server);
  return { health, appEnv: server.config.appEnv, emailTransport: server.config.email.transport };
}

const STATE: Record<string, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not configured",
};

export default function System({ loaderData }: Route.ComponentProps) {
  const { health } = loaderData;
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="System"
        description={`Environment: ${loaderData.appEnv} · Email transport: ${loaderData.emailTransport} · Checked ${formatDateTime(Date.parse(health.checkedAt))}`}
      />
      <Panel title={`Overall: ${STATE[health.overall] ?? health.overall}`}>
        <table>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">State</th>
              <th scope="col">Latency</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {health.components.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{STATE[c.state] ?? c.state}</td>
                <td>{c.latencyMs !== undefined ? `${c.latencyMs} ms` : "—"}</td>
                <td>{c.detail ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
