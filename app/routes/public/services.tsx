import { Link } from "react-router";
import { load } from "~/.server/guards";
import { listPublishedServices } from "~/.server/services/published-content";
import type { Route } from "./+types/services";
import styles from "./site.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  const services = await listPublishedServices(load(context).server);
  return {
    services: services.map((s) => ({
      slug: String(s.slug ?? ""),
      name: String(s.name ?? ""),
      summary: typeof s.summary === "string" ? s.summary : null,
      deliveryModel: String(s.deliveryModel ?? "vora"),
    })),
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Services — VORA" }];
}

export default function Services({ loaderData }: Route.ComponentProps) {
  return (
    <section className={`container ${styles.page}`} aria-labelledby="services-title">
      <header className={styles.pageHeader}>
        <p className="label">Services</p>
        <h1 id="services-title">Services</h1>
      </header>
      {loaderData.services.length === 0 ? (
        <div className={styles.empty}>
          <p>Service details are being prepared.</p>
          <p className="muted">
            In the meantime, <Link to="/contact">tell us about your project</Link>.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {loaderData.services.map((s) => (
            <li key={s.slug}>
              <h2>
                <Link to={`/services/${s.slug}`}>{s.name}</Link>
              </h2>
              {s.summary ? <p className="muted">{s.summary}</p> : null}
              {s.deliveryModel !== "vora" ? (
                <p className="label">Creative by Solara. Digital by VORA.</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
