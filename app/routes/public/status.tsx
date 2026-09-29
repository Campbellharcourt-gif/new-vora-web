import { load } from "~/.server/guards";
import { publicHealth, systemHealth } from "~/.server/services/health";
import type { Route } from "./+types/status";
import styles from "./site.module.css";

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

export default function Status({ loaderData }: Route.ComponentProps) {
  return (
    <section className={`container ${styles.page}`} aria-labelledby="status-title">
      <header className={styles.pageHeader}>
        <p className="label">Status</p>
        <h1 id="status-title">
          {loaderData.overall === "operational"
            ? "All systems operational"
            : "Some systems are affected"}
        </h1>
        <p className="muted">Checked {new Date(loaderData.checkedAt).toUTCString()}</p>
      </header>
      <table>
        <caption className="visually-hidden">Service status</caption>
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
              <td>{LABEL[c.state] ?? c.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
