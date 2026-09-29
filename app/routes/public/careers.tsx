import { Link } from "react-router";
import { load } from "~/.server/guards";
import { listOpenRoles } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import type { Route } from "./+types/careers";
import styles from "./site.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [roles, emails] = await Promise.all([
    listOpenRoles(server),
    getSetting(server, "contact.emails"),
  ]);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    careersEmail: emails.careers,
    roles: roles.map((r) => ({
      slug: String(r.slug ?? ""),
      title: String(r.title ?? ""),
      summary: str(r.summary),
      location: str(r.locationText),
    })),
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Careers — VORA" }];
}

export default function Careers({ loaderData }: Route.ComponentProps) {
  return (
    <section className={`container ${styles.page}`} aria-labelledby="careers-title">
      <header className={styles.pageHeader}>
        <p className="label">Careers</p>
        <h1 id="careers-title">Careers</h1>
      </header>
      {loaderData.roles.length === 0 ? (
        <div className={styles.empty}>
          <p>There are no open roles right now.</p>
          <p className="muted">
            You can still introduce yourself at{" "}
            <a href={`mailto:${loaderData.careersEmail}`}>{loaderData.careersEmail}</a>.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {loaderData.roles.map((r) => (
            <li key={r.slug}>
              <h2>
                <Link to={`/careers/${r.slug}`}>{r.title}</Link>
              </h2>
              {r.location ? <p className="label">{r.location}</p> : null}
              {r.summary ? <p className="muted">{r.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
