import { blocksSchema } from "@shared/content/blocks";
import { load } from "~/.server/guards";
import { getPublishedPageEntry } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Blocks, outline } from "~/components/content/Blocks";
import { EmptyState, Label, Lines } from "~/components/vora/primitives";
import type { Route } from "./+types/legal";

/** Legal pages are light reading pages with the reading-progress rule (§16.11). */
export const handle = { theme: "mist", reading: true };

const TITLES = { terms: "Terms", privacy: "Privacy", cookies: "Cookies" } as const;
type LegalKey = keyof typeof TITLES;

function keyFromUrl(url: string): LegalKey {
  const path = new URL(url).pathname.replace(/^\//, "");
  return path === "terms" || path === "privacy" || path === "cookies" ? path : "privacy";
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { server } = load(context);
  const key = keyFromUrl(request.url);
  const [entry, emails] = await Promise.all([
    getPublishedPageEntry(server, key),
    getSetting(server, "contact.emails"),
  ]);
  const body = entry ? blocksSchema.safeParse(entry.snapshot.body) : null;
  return {
    key,
    title: entry ? String(entry.snapshot.title ?? TITLES[key]) : TITLES[key],
    publishedAt: entry?.publishedAt ?? null,
    body: body?.success ? body.data : null,
    contact: emails.general,
  };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${loaderData?.title ?? "Legal"} — VORA` }];
}

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

/**
 * Legal (§16.11, Mist): the title, "Last updated", a sticky contents list built from the h2s,
 * the text at the measure, and a closing contact line. A draft is never published here: until
 * the notice is written, approved and published, the page says so plainly.
 */
export default function Legal({ loaderData }: Route.ComponentProps) {
  const { title, body, publishedAt, contact } = loaderData;
  const contents = body ? outline(body) : [];
  const list = (
    <ol>
      {contents.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`}>{item.text}</a>
        </li>
      ))}
    </ol>
  );
  return (
    <article className="v-container" style={{ paddingBottom: "var(--section-m)" }}>
      <header className="v-opening" data-reveal="">
        <Label fade>Legal</Label>
        <Lines as="h1" className="v-display-m" lines={[title]} />
        {publishedAt ? (
          <p className="v-data v-secondary">
            Last updated{" "}
            <time dateTime={new Date(publishedAt).toISOString()}>{formatDate(publishedAt)}</time>
          </p>
        ) : null}
      </header>

      {body ? (
        <div className="v-legal">
          {contents.length > 1 ? (
            <>
              <details className="v-toc v-toc--mobile">
                <summary className="v-label">Contents</summary>
                {list}
              </details>
              <nav className="v-toc v-toc--desktop" aria-label="Contents">
                <p className="v-label">Contents</p>
                {list}
              </nav>
            </>
          ) : null}
          <div className="v-legal__text">
            <Blocks blocks={body} />
            <p className="v-body" style={{ marginTop: "var(--space-8)" }}>
              Questions about this notice?{" "}
              <a className="v-link" href={`mailto:${contact}`}>
                {contact}
              </a>
            </p>
          </div>
        </div>
      ) : (
        <EmptyState>
          <p className="v-body">This page is being finalised.</p>
          <p className="v-body-s">
            Questions in the meantime:{" "}
            <a className="v-link" href={`mailto:${contact}`}>
              {contact}
            </a>
            .
          </p>
        </EmptyState>
      )}
    </article>
  );
}
