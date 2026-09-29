import { blocksSchema } from "@shared/content/blocks";
import { Link } from "react-router";
import { load } from "~/.server/guards";
import { getPublishedPage } from "~/.server/services/published-content";
import { Blocks } from "~/components/content/Blocks";
import type { Route } from "./+types/our-story";
import styles from "./site.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  const page = await getPublishedPage(load(context).server, "our-story");
  if (!page) return { page: null };
  const body = blocksSchema.safeParse(page.body);
  return {
    page: {
      title: String(page.title ?? "Our Story"),
      intro: typeof page.intro === "string" ? page.intro : null,
      body: body.success ? body.data : [],
    },
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Our Story — VORA" }];
}

export default function OurStory({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  return (
    <article className={`container ${styles.page}`}>
      <header className={styles.pageHeader}>
        <p className="label">Our Story</p>
        <h1>{page?.title ?? "Our Story"}</h1>
        {page?.intro ? <p className="muted">{page.intro}</p> : null}
      </header>
      {page ? (
        <Blocks blocks={page.body} />
      ) : (
        <div className={styles.empty}>
          <p>This story is being written.</p>
          <p className="muted">
            <Link to="/contact">Get in touch</Link> in the meantime.
          </p>
        </div>
      )}
    </article>
  );
}
