import { Link } from "react-router";
import { load } from "~/.server/guards";
import { listPublishedPartners } from "~/.server/services/published-content";
import type { Route } from "./+types/partners";
import styles from "./site.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  const partners = await listPublishedPartners(load(context).server);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    partners: partners.map((p) => ({
      slug: String(p.slug ?? ""),
      name: String(p.name ?? ""),
      relationship: str(p.relationship),
      description: str(p.description),
      statement: str(p.statement),
      url: str(p.url),
    })),
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Partners — VORA" }];
}

export default function Partners({ loaderData }: Route.ComponentProps) {
  return (
    <section className={`container ${styles.page}`} aria-labelledby="partners-title">
      <header className={styles.pageHeader}>
        <p className="label">Partners</p>
        <h1 id="partners-title">Partners</h1>
      </header>
      {loaderData.partners.length === 0 ? (
        <div className={styles.empty}>
          <p>Partnership details are being prepared.</p>
          <p className="muted">
            Interested in partnering with VORA? <Link to="/contact">Get in touch</Link>.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {loaderData.partners.map((p) => (
            <li key={p.slug}>
              <h2>{p.name}</h2>
              {p.relationship ? <p className="label">{p.relationship}</p> : null}
              {p.description ? <p className="muted">{p.description}</p> : null}
              {p.statement ? <p>{p.statement}</p> : null}
              {p.url ? (
                <p>
                  <a href={p.url} rel="noopener noreferrer" target="_blank">
                    Visit {p.name}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
