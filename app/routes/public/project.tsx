import { blocksSchema } from "@shared/content/blocks";
import { data, Link } from "react-router";
import { load } from "~/.server/guards";
import { getPublishedProject } from "~/.server/services/published-content";
import { Blocks } from "~/components/content/Blocks";
import type { Route } from "./+types/project";
import styles from "./site.module.css";

export async function loader({ context, params }: Route.LoaderArgs) {
  const snapshot = await getPublishedProject(load(context).server, params.slug);
  if (!snapshot) throw data({ message: "Not found" }, { status: 404 });
  const body = blocksSchema.safeParse(snapshot.body);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const credits = Array.isArray(snapshot.credits)
    ? (snapshot.credits as { role?: unknown; name?: unknown }[])
        .filter((c) => typeof c.role === "string" && typeof c.name === "string")
        .map((c) => ({ role: String(c.role), name: String(c.name) }))
    : [];
  return {
    title: String(snapshot.title ?? ""),
    summary: str(snapshot.summary),
    category: str(snapshot.category),
    clientName: str(snapshot.clientName),
    year: typeof snapshot.year === "number" ? snapshot.year : null,
    externalUrl: str(snapshot.externalUrl),
    seoTitle: str(snapshot.seoTitle),
    seoDescription: str(snapshot.seoDescription),
    credits,
    body: body.success ? body.data : [],
  };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData) return [{ title: "Not found — VORA" }];
  return [
    { title: loaderData.seoTitle ?? `${loaderData.title} — VORA` },
    ...(loaderData.seoDescription
      ? [{ name: "description", content: loaderData.seoDescription }]
      : []),
  ];
}

export default function Project({ loaderData: p }: Route.ComponentProps) {
  return (
    <article className={`container ${styles.page}`}>
      <header className={styles.pageHeader}>
        <p className="label">
          <Link to="/work">Work</Link>
        </p>
        <h1>{p.title}</h1>
        <p className="label">{[p.category, p.clientName, p.year].filter(Boolean).join(" · ")}</p>
        {p.summary ? <p className="muted">{p.summary}</p> : null}
        {p.externalUrl ? (
          <p>
            <a href={p.externalUrl} rel="noopener noreferrer" target="_blank">
              Visit the live site<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        ) : null}
      </header>
      <Blocks blocks={p.body} />
      {p.credits.length > 0 ? (
        <section aria-labelledby="credits" style={{ marginTop: "var(--space-7)" }}>
          <h2 id="credits">Credits</h2>
          <dl>
            {p.credits.map((c) => (
              <div key={`${c.role}-${c.name}`}>
                <dt className="label">{c.role}</dt>
                <dd style={{ margin: 0 }}>{c.name}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  );
}
