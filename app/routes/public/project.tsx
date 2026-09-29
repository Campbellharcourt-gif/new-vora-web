import { blocksSchema } from "@shared/content/blocks";
import { data } from "react-router";
import { load } from "~/.server/guards";
import {
  getPublishedProject,
  listPublishedProjectServices,
  listPublishedProjects,
} from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Blocks } from "~/components/content/Blocks";
import { Aperture } from "~/components/vora/aperture";
import {
  BackLink,
  ExternalLink,
  Invitation,
  Label,
  Lines,
  SectionHeader,
  Slot,
} from "~/components/vora/primitives";
import {
  Credits,
  NextProject,
  ProjectFacts,
  projectMeta,
  projectTransitionName,
} from "~/components/vora/projects";
import type { Route } from "./+types/project";

export const handle = { reading: true };

export async function loader({ context, params }: Route.LoaderArgs) {
  const { server } = load(context);
  const snapshot = await getPublishedProject(server, params.slug);
  if (!snapshot) throw data({ message: "Not found" }, { status: 404 });
  const [all, links, emails] = await Promise.all([
    listPublishedProjects(server),
    listPublishedProjectServices(server),
    getSetting(server, "contact.emails"),
  ]);
  const body = blocksSchema.safeParse(snapshot.body);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const credits = Array.isArray(snapshot.credits)
    ? (snapshot.credits as { role?: unknown; name?: unknown }[])
        .filter((c) => typeof c.role === "string" && typeof c.name === "string")
        .map((c) => ({ role: String(c.role), name: String(c.name) }))
    : [];
  const position = all.findIndex((p) => p.slug === params.slug);
  const nextSummary = all.length > 1 && position >= 0 ? all[(position + 1) % all.length] : null;
  return {
    slug: params.slug,
    title: String(snapshot.title ?? ""),
    summary: str(snapshot.summary),
    category: str(snapshot.category),
    clientName: str(snapshot.clientName),
    year: typeof snapshot.year === "number" ? snapshot.year : null,
    externalUrl: str(snapshot.externalUrl),
    seoTitle: str(snapshot.seoTitle),
    seoDescription: str(snapshot.seoDescription),
    services: links
      .filter((l) => l.projectSlug === params.slug)
      .map((l) => ({ slug: l.serviceSlug, name: l.serviceName })),
    credits,
    body: body.success ? body.data : [],
    next: nextSummary
      ? {
          slug: nextSummary.slug,
          title: nextSummary.title,
          category: nextSummary.category,
          summary: nextSummary.summary,
          year: nextSummary.year,
        }
      : null,
    projectsEmail: emails.projects,
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

/** Case study (§16.3): hero → facts → story → people → where next. Facts only. */
export default function Project({ loaderData: p }: Route.ComponentProps) {
  const meta = projectMeta(p);
  return (
    <article>
      <header className="v-container v-container--wide" style={{ paddingTop: "var(--space-7)" }}>
        <div className="v-feature" data-reveal="">
          <BackLink to="/work">Work</BackLink>
          <Aperture
            ratio={null}
            plate="horizon"
            slotLabel="Cover media"
            transitionName={projectTransitionName(p.slug)}
            priority
          />
          <Lines as="h1" className="v-display-l v-feature__title" lines={[p.title]} />
          <div className="v-feature__meta">
            {meta ? <Label fade>{meta}</Label> : <span />}
            {p.summary ? <p className="v-lead v-body v-fade">{p.summary}</p> : null}
            {p.externalUrl ? <ExternalLink href={p.externalUrl}>Visit site</ExternalLink> : null}
          </div>
        </div>
      </header>

      <div className="v-container v-section--s">
        <ProjectFacts
          clientName={p.clientName}
          year={p.year}
          category={p.category}
          services={p.services}
          externalUrl={p.externalUrl}
        />
      </div>

      {p.body.length > 0 ? (
        <section className="v-container" aria-label="The project">
          <div className="v-grid">
            <div className="v-case-body">
              <Blocks blocks={p.body} />
            </div>
          </div>
        </section>
      ) : null}

      {p.credits.length > 0 ? (
        <section className="v-container v-section--s" aria-labelledby="credits">
          <div className="v-stack" style={{ gap: "var(--space-6)" }}>
            <SectionHeader
              id="credits"
              label="Credits"
              title={["Credits"]}
              titleClass="v-heading-l"
              margin={false}
            />
            <Credits credits={p.credits} />
          </div>
        </section>
      ) : null}

      <Invitation line={<Slot>{p.title} invitation — copy slot</Slot>} email={p.projectsEmail} />

      {p.next ? (
        <div
          className="v-container v-container--wide"
          style={{ paddingBottom: "var(--section-m)" }}
        >
          <NextProject project={p.next} />
        </div>
      ) : null}
    </article>
  );
}
