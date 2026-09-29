import { blocksSchema } from "@shared/content/blocks";
import { load } from "~/.server/guards";
import { getPublishedPage } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Blocks } from "~/components/content/Blocks";
import type { Route } from "./+types/legal";
import styles from "./site.module.css";

const TITLES = { terms: "Terms", privacy: "Privacy", cookies: "Cookies" } as const;
type LegalKey = keyof typeof TITLES;

function keyFromUrl(url: string): LegalKey {
  const path = new URL(url).pathname.replace(/^\//, "");
  return path === "terms" || path === "privacy" || path === "cookies" ? path : "privacy";
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { server } = load(context);
  const key = keyFromUrl(request.url);
  const [page, emails] = await Promise.all([
    getPublishedPage(server, key),
    getSetting(server, "contact.emails"),
  ]);
  const body = page ? blocksSchema.safeParse(page.body) : null;
  return {
    key,
    title: page ? String(page.title ?? TITLES[key]) : TITLES[key],
    body: body?.success ? body.data : null,
    contact: emails.general,
  };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${loaderData?.title ?? "Legal"} — VORA` }];
}

export default function Legal({ loaderData }: Route.ComponentProps) {
  return (
    <article className={`container ${styles.page}`}>
      <header className={styles.pageHeader}>
        <p className="label">Legal</p>
        <h1>{loaderData.title}</h1>
      </header>
      {loaderData.body ? (
        <Blocks blocks={loaderData.body} />
      ) : (
        <div className={styles.empty}>
          <p>This page is being finalised.</p>
          <p className="muted">
            Questions in the meantime:{" "}
            <a href={`mailto:${loaderData.contact}`}>{loaderData.contact}</a>.
          </p>
        </div>
      )}
    </article>
  );
}
