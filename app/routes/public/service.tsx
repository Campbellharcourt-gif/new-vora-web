import { blocksSchema } from "@shared/content/blocks";
import { data } from "react-router";
import { load } from "~/.server/guards";
import {
  getPublishedService,
  listPublishedProjectServices,
  listPublishedProjects,
} from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Blocks } from "~/components/content/Blocks";
import { Aperture } from "~/components/vora/aperture";
import {
  BackLink,
  Invitation,
  Label,
  Lines,
  SectionHeader,
  Slot,
} from "~/components/vora/primitives";
import { ProjectFeature } from "~/components/vora/projects";
import { deliveryLabel, ProcessLine, WhoDoesWhat } from "~/components/vora/services";
import type { Route } from "./+types/service";

export async function loader({ context, params }: Route.LoaderArgs) {
  const { server } = load(context);
  const snapshot = await getPublishedService(server, params.slug);
  if (!snapshot) throw data({ message: "Not found" }, { status: 404 });
  const [projects, links, emails] = await Promise.all([
    listPublishedProjects(server),
    listPublishedProjectServices(server),
    getSetting(server, "contact.emails"),
  ]);
  const body = blocksSchema.safeParse(snapshot.body);
  const related = new Set(
    links.filter((l) => l.serviceSlug === params.slug).map((l) => l.projectSlug),
  );
  return {
    slug: params.slug,
    name: String(snapshot.name ?? ""),
    summary: typeof snapshot.summary === "string" ? snapshot.summary : null,
    deliveryModel: String(snapshot.deliveryModel ?? "vora"),
    seoTitle: typeof snapshot.seoTitle === "string" ? snapshot.seoTitle : null,
    seoDescription: typeof snapshot.seoDescription === "string" ? snapshot.seoDescription : null,
    body: body.success ? body.data : [],
    related: projects
      .filter((p) => related.has(p.slug))
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        summary: p.summary,
        year: p.year,
      })),
    projectsEmail: emails.projects,
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

/**
 * Service page (§16.5), the shared template: ServiceHero → what this covers → who does what →
 * related work (only when it exists) → the Process → the invitation.
 */
export default function Service({ loaderData: s }: Route.ComponentProps) {
  let index = 0;
  const next = () => String(++index).padStart(2, "0");
  return (
    <article>
      <header className="v-opening v-container" data-reveal="">
        <BackLink to="/services">Services</BackLink>
        <Lines as="h1" className="v-display-l" lines={[s.name]} />
        {s.summary ? <p className="v-lead v-fade">{s.summary}</p> : null}
        <Label fade i={2}>
          {deliveryLabel(s.deliveryModel)}
        </Label>
      </header>

      <div className="v-container v-container--wide">
        <Aperture ratio="21/9" plate="horizon" slotLabel={`${s.name} plate or film`} priority />
      </div>

      <section className="v-container v-section" aria-labelledby="covers">
        <div className="v-stack" style={{ gap: "var(--space-7)" }}>
          <SectionHeader
            id="covers"
            label={`${next()} — What this covers`}
            title={["What this covers"]}
            titleClass="v-heading-l"
          />
          <div className="v-sechead">
            <div className="v-sechead__body">
              {s.body.length > 0 ? (
                <Blocks blocks={s.body} />
              ) : (
                <p className="v-body">
                  <Slot>What {s.name} covers — copy slot</Slot>
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="v-container" aria-labelledby="who">
        <div className="v-stack" style={{ gap: "var(--space-7)" }}>
          <SectionHeader
            id="who"
            label={`${next()} — Who does what`}
            title={["Who does what"]}
            titleClass="v-heading-l"
          />
          <div className="v-sechead">
            <div className="v-sechead__body">
              <WhoDoesWhat model={s.deliveryModel} />
            </div>
          </div>
        </div>
      </section>

      {s.related.length > 0 ? (
        <section className="v-container v-container--wide v-section" aria-labelledby="related">
          <div className="v-stack" style={{ gap: "var(--section-s)" }}>
            <SectionHeader
              id="related"
              label={`${next()} — Related work`}
              title={["Related work"]}
              titleClass="v-heading-l"
            />
            <div className="v-features">
              {s.related.map((p, i) => (
                <ProjectFeature
                  key={p.slug}
                  project={p}
                  index={i + 1}
                  total={s.related.length}
                  align={i % 2 === 0 ? "left" : "right"}
                  headingLevel="h3"
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="v-container v-section" aria-labelledby="process">
        <div className="v-stack" style={{ gap: "var(--space-8)" }}>
          <SectionHeader
            id="process"
            label={`${next()} — Process`}
            title={["How we work"]}
            titleClass="v-heading-l"
          />
          <ProcessLine />
        </div>
      </section>

      <Invitation line={<Slot>{s.name} invitation — copy slot</Slot>} email={s.projectsEmail} />
    </article>
  );
}
