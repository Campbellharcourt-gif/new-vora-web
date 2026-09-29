import { Link } from "react-router";
import { load } from "~/.server/guards";
import { listPublishedProjects } from "~/.server/services/published-content";
import type { Route } from "./+types/work";
import styles from "./site.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  return { projects: await listPublishedProjects(load(context).server) };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Work — VORA" }];
}

export default function Work({ loaderData }: Route.ComponentProps) {
  return (
    <section className={`container ${styles.page}`} aria-labelledby="work-title">
      <header className={styles.pageHeader}>
        <p className="label">Work</p>
        <h1 id="work-title">Work</h1>
      </header>
      {loaderData.projects.length === 0 ? (
        <div className={styles.empty}>
          <p>Case studies are being prepared for publication.</p>
          <p className="muted">
            To talk about a project, <Link to="/contact">get in touch</Link>.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {loaderData.projects.map((p) => (
            <li key={p.slug}>
              <h2>
                <Link to={`/work/${p.slug}`}>{p.title}</Link>
              </h2>
              <p className="label">
                {[p.category, p.clientName, p.year].filter(Boolean).join(" · ")}
              </p>
              {p.summary ? <p className="muted">{p.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
