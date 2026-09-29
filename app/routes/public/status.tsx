import { load } from "~/.server/guards";
import { publicHealth, systemHealth } from "~/.server/services/health";
import { Label, StatusIndicator, type StatusKind } from "~/components/vora/primitives";
import type { Route } from "./+types/status";

export async function loader({ context }: Route.LoaderArgs) {
  const health = publicHealth(await systemHealth(load(context).server));
  return health;
}

export function headers(): HeadersInit {
  return { "Cache-Control": "public, max-age=30" };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Status — VORA" }];
}

const LABEL: Record<string, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Unavailable",
  not_configured: "Not in use",
};

const KIND: Record<string, StatusKind> = {
  operational: "ok",
  degraded: "warn",
  down: "down",
  not_configured: "muted",
};

/** Status (§16.12): honest, coarse, minimal — the headline, the time, the component table. */
export default function Status({ loaderData }: Route.ComponentProps) {
  return (
    <section
      className="v-container"
      aria-labelledby="status-title"
      style={{ paddingBottom: "var(--section-m)" }}
    >
      <header className="v-opening">
        <Label>Status</Label>
        <h1 id="status-title" className="v-display-m">
          {loaderData.overall === "operational"
            ? "All systems operational"
            : "Some systems are affected"}
        </h1>
        <p className="v-data v-secondary">
          Checked{" "}
          <time dateTime={new Date(loaderData.checkedAt).toISOString()}>
            {new Date(loaderData.checkedAt).toUTCString()}
          </time>
        </p>
      </header>
      <div className="v-tablewrap" style={{ maxWidth: "48rem" }}>
        <table className="v-table v-table--stack">
          <caption className="v-sr">Service status</caption>
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {loaderData.components.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td data-label="State">
                  <StatusIndicator kind={KIND[c.state] ?? "muted"}>
                    {LABEL[c.state] ?? c.state}
                  </StatusIndicator>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="v-refresh">
        <a className="v-arrowlink" href="/status">
          <span>Refresh</span>
        </a>
      </p>
    </section>
  );
}
