import { blocksSchema } from "@shared/content/blocks";
import { data, Link } from "react-router";
import { load } from "~/.server/guards";
import { getPublishedService } from "~/.server/services/published-content";
import { Blocks } from "~/components/content/Blocks";
import type { Route } from "./+types/service";
import styles from "./site.module.css";

export async function loader({ context, params }: Route.LoaderArgs) {
  const snapshot = await getPublishedService(load(context).server, params.slug);
  if (!snapshot) throw data({ message: "Not found" }, { status: 404 });
  const body = blocksSchema.safeParse(snapshot.body);
  return {
    name: String(snapshot.name ?? ""),
    summary: typeof snapshot.summary === "string" ? snapshot.summary : null,
    deliveryModel: String(snapshot.deliveryModel ?? "vora"),
    seoTitle: typeof snapshot.seoTitle === "string" ? snapshot.seoTitle : null,
    seoDescription: typeof snapshot.seoDescription === "string" ? snapshot.seoDescription : null,
    body: body.success ? body.data : [],
  };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData) return [{ title: "Not found — VORA" }];
  return [
    { title: loaderData.seoTitle ?? `${loaderData.name} — VORA` },
    ...(loaderData.seoDescription
      ? [{ name: "description", content: loaderData.seoDescription }]
      : []),
  ];
}

export default function Service({ loaderData }: Route.ComponentProps) {
  return (
    <article className={`container ${styles.page}`}>
      <header className={styles.pageHeader}>
        <p className="label">
          <Link to="/services">Services</Link>
        </p>
        <h1>{loaderData.name}</h1>
        {loaderData.summary ? <p className="muted">{loaderData.summary}</p> : null}
        {loaderData.deliveryModel !== "vora" ? (
          <p className="label">
            Creative by <Link to="/partners">Solara</Link>. Digital by VORA.
          </p>
        ) : null}
      </header>
      <Blocks blocks={loaderData.body} />
    </article>
  );
}
