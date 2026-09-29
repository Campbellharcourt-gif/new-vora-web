import { blocksSchema } from "@shared/content/blocks";
import { data, Link } from "react-router";
import { load } from "~/.server/guards";
import { listOpenRoles } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Blocks } from "~/components/content/Blocks";
import type { Route } from "./+types/career";
import styles from "./site.module.css";

export async function loader({ context, params }: Route.LoaderArgs) {
  const { server } = load(context);
  const roles = await listOpenRoles(server);
  const role = roles.find((r) => r.slug === params.slug);
  if (!role) throw data({ message: "Not found" }, { status: 404 });
  const emails = await getSetting(server, "contact.emails");
  const body = blocksSchema.safeParse(role.body);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    title: String(role.title ?? ""),
    summary: str(role.summary),
    location: str(role.locationText),
    applicationMode: String(role.applicationMode ?? "email"),
    externalUrl: str(role.externalUrl),
    careersEmail: emails.careers,
    body: body.success ? body.data : [],
  };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: loaderData ? `${loaderData.title} — Careers — VORA` : "Not found — VORA" }];
}

export default function Career({ loaderData: r }: Route.ComponentProps) {
  return (
    <article className={`container ${styles.page}`}>
      <header className={styles.pageHeader}>
        <p className="label">
          <Link to="/careers">Careers</Link>
        </p>
        <h1>{r.title}</h1>
        {r.location ? <p className="label">{r.location}</p> : null}
        {r.summary ? <p className="muted">{r.summary}</p> : null}
      </header>
      <Blocks blocks={r.body} />
      <section aria-labelledby="apply" style={{ marginTop: "var(--space-7)" }} className="stack">
        <h2 id="apply">How to apply</h2>
        {r.applicationMode === "external" && r.externalUrl ? (
          <p>
            <a href={r.externalUrl} rel="noopener noreferrer" target="_blank">
              Apply on the hiring page<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        ) : (
          // The in-site application form (with private CV upload) ships in Phase 4/5.
          <p>
            Email{" "}
            <a href={`mailto:${r.careersEmail}?subject=${encodeURIComponent(r.title)}`}>
              {r.careersEmail}
            </a>{" "}
            with your portfolio and a short note about you.
          </p>
        )}
      </section>
    </article>
  );
}
