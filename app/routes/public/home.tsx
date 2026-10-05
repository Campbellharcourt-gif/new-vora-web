import type { CSSProperties, ReactNode } from "react";
import { load } from "~/.server/guards";
import { listPublishedProjects, listPublishedServices } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Logo } from "~/components/ui/Logo";
import {
  ArrowLink,
  Em,
  EmptyState,
  Invitation,
  Label,
  Lines,
  SectionHeader,
  SiteLink,
  Slot,
  SurveyLine,
  statementLines,
  Times,
} from "~/components/vora/primitives";
import { ProjectFeature } from "~/components/vora/projects";
import { ServiceList } from "~/components/vora/services";
import type { Route } from "./+types/home";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [projects, services, identity, emails, copy] = await Promise.all([
    listPublishedProjects(server),
    listPublishedServices(server),
    getSetting(server, "site.identity"),
    getSetting(server, "contact.emails"),
    getSetting(server, "home.copy"),
  ]);
  // Chambers shows the featured projects; with none marked featured, the published ones.
  const featured = projects.filter((p) => p.isFeatured);
  const chambers = (featured.length > 0 ? featured : projects).slice(0, 3);
  return {
    projects: chambers.map((p) => ({
      slug: p.slug,
      title: p.title,
      category: p.category,
      summary: p.summary,
      year: p.year,
    })),
    services: services.map((s) => ({
      slug: String(s.slug ?? ""),
      name: String(s.name ?? ""),
      summary: typeof s.summary === "string" ? s.summary : null,
      deliveryModel: String(s.deliveryModel ?? "vora"),
    })),
    partnerLine: identity.partnerLine,
    tagline: identity.tagline,
    projectsEmail: emails.projects,
    approachLines: copy.approachLines,
    invitationLine: copy.invitationLine,
  };
}

export function meta(): Route.MetaDescriptors {
  return [
    { title: "VORA — Digital studio" },
    {
      name: "description",
      content: "VORA is a digital studio building websites and digital experiences.",
    },
  ];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Admin-edited lines mark one italic phrase as *phrase* (Content › Home page). */
function emphasised(line: string): ReactNode {
  const match = /^(.*?)\*([^*]+)\*(.*)$/.exec(line);
  if (!match) return line;
  return (
    <>
      {match[1]}
      <Em>{match[2]}</Em>
      {match[3]}
    </>
  );
}

/**
 * Home — the station sequence (design system §16.1) in its T0 typographic version: the
 * Blender plates and real-time layer (D9) are not supplied yet, so each station is a composed
 * typographic shot on Basalt, with the survey line as its horizon. The plates are added on top
 * later without restructuring the page. Copy is real (Mark4) or a marked slot.
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { projects, services, partnerLine, tagline, projectsEmail, approachLines, invitationLine } =
    loaderData;
  let index = 0;
  const next = () => pad(++index);
  const approachIndex = next();
  const workIndex = next();
  const servicesIndex = services.length > 0 ? next() : null;
  const partnershipIndex = partnerLine ? next() : null;

  return (
    <>
      {/* 1 · Threshold — the wordmark on the horizon, one positioning line. */}
      <section
        className="v-first v-threshold v-container"
        aria-labelledby="home-title"
        data-reveal=""
      >
        <div className="v-threshold__horizon">
          <h1 id="home-title" className="v-settle">
            <Logo title="VORA" className="v-threshold__wordmark" />
          </h1>
          <SurveyLine variant="draw" strong />
          <p className="v-display-m v-threshold__line">
            {tagline ? (
              tagline
            ) : (
              <>
                Design{"\u00a0"}
                <Times /> Technology{"\u00a0"}
                <Times /> Identity.
              </>
            )}
          </p>
        </div>
        <div className="v-threshold__rule" aria-hidden="true" />
      </section>

      {/* 2 · Approach — what VORA is, two sentences at most (real Mark4 lines; slot for the final copy). */}
      <section className="v-station v-container" aria-labelledby="home-approach">
        <div className="v-grid">
          <div className="v-approach__text" data-reveal="">
            <Label fade>{approachIndex} — Approach</Label>
            <Lines
              as="h2"
              id="home-approach"
              className="v-display-m"
              lines={approachLines.map(emphasised)}
            />
          </div>
        </div>
      </section>

      {/* 3 · Chambers — published work, one project per opening. */}
      <section className="v-station v-container v-container--wide" aria-labelledby="home-work">
        <div className="v-stack" style={{ gap: "var(--section-s)" }}>
          <SectionHeader
            id="home-work"
            label={`${workIndex} — Work`}
            title={["Work"]}
            titleClass="v-display-l"
          />
          {projects.length > 0 ? (
            <>
              <div className="v-features">
                {projects.map((p, i) => (
                  <ProjectFeature
                    key={p.slug}
                    project={p}
                    index={i + 1}
                    total={projects.length}
                    align={i % 2 === 0 ? "left" : "right"}
                    headingLevel="h3"
                  />
                ))}
              </div>
              <p>
                <ArrowLink to="/work">See all work</ArrowLink>
              </p>
            </>
          ) : (
            <EmptyState>
              <p className="v-body">Case studies are being prepared for publication.</p>
              <p className="v-body-s">
                To talk about a project,{" "}
                <SiteLink className="v-link" to="/contact">
                  get in touch
                </SiteLink>
                .
              </p>
            </EmptyState>
          )}
        </div>
      </section>

      {/* 4 · Terraces — the services and who delivers them. */}
      {servicesIndex ? (
        <section className="v-station v-container" aria-labelledby="home-services">
          <div className="v-stack" style={{ gap: "var(--space-8)" }}>
            <SectionHeader
              id="home-services"
              label={`${servicesIndex} — Services`}
              title={["Services"]}
              link={{ to: "/services", label: "All services" }}
            />
            <ServiceList services={services} />
          </div>
        </section>
      ) : null}

      {/* 5 · Reflection — the page inverts to Mist for the partnership statement. */}
      {partnerLine && partnershipIndex ? (
        <section data-theme="mist" className="v-chapter" aria-labelledby="home-partnership">
          <div className="v-container v-chapter--center" data-reveal="">
            <Label fade>{partnershipIndex} — Partnership</Label>
            <Lines
              as="h2"
              id="home-partnership"
              className="v-display-l"
              lines={statementLines(partnerLine)}
            />
            <p className="v-fade" style={{ "--i": 2 } as CSSProperties}>
              <ArrowLink to="/partners">About the partnership</ArrowLink>
            </p>
          </div>
        </section>
      ) : null}

      {/* 6 · Horizon — the invitation. */}
      <Invitation
        line={
          invitationLine ? emphasised(invitationLine) : <Slot>Home invitation — copy slot</Slot>
        }
        email={projectsEmail}
      />
    </>
  );
}
