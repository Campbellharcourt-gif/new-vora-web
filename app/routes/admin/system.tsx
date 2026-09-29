import { load, requirePermission } from "~/.server/guards";
import { systemHealth } from "~/.server/services/health";
import { HealthTag } from "~/components/workspace/status";
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
        actions={
          <HealthTag
            state={health.overall}
            label={`Overall: ${STATE[health.overall] ?? health.overall}`}
          />
        }
      />
      <p className="v-data v-secondary">
        Environment: {loaderData.appEnv} · Email transport: {loaderData.emailTransport} · Checked{" "}
        {formatDateTime(Date.parse(health.checkedAt))}
      </p>
      <Panel title="Health" flush>
        <div className="v-tablewrap">
          <table className="v-table v-table--stack">
            <caption className="v-sr">Component health</caption>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">State</th>
                <th scope="col" className="num">
                  Latency
                </th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {health.components.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td data-label="State">
                    <HealthTag state={c.state} label={STATE[c.state] ?? c.state} />
                  </td>
                  <td data-label="Latency" className="num">
                    {c.latencyMs !== undefined ? `${c.latencyMs} ms` : "—"}
                  </td>
                  <td data-label="Detail">{c.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
