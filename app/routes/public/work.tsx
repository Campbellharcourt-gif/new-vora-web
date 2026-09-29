import { load } from "~/.server/guards";
import { listPublishedProjects } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { EmptyState, Invitation, Label, Lines, SiteLink, Slot } from "~/components/vora/primitives";
import { ProjectFeature, ProjectRows, ProjectTiles } from "~/components/vora/projects";
import type { Route } from "./+types/work";

/** Thresholds from the design system (§7.2, §16.2). */
const TILES_FROM = 4;
const INDEX_FROM = 6;
const FILTERS_FROM = { projects: 6, categories: 2 };

const categoryKey = (c: string) => c.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export async function loader({ context, request }: Route.LoaderArgs) {
  const { server } = load(context);
  const [all, emails] = await Promise.all([
    listPublishedProjects(server),
    getSetting(server, "contact.emails"),
  ]);
  const categories = [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))];
  const filterable =
    all.length >= FILTERS_FROM.projects && categories.length >= FILTERS_FROM.categories;
  const requested = new URL(request.url).searchParams.get("category");
  const active = filterable ? (categories.find((c) => categoryKey(c) === requested) ?? null) : null;
  const projects = active ? all.filter((p) => p.category === active) : all;
  return {
    total: all.length,
    projects: projects.map((p) => ({
      slug: p.slug,
      title: p.title,
      category: p.category,
      summary: p.summary,
      year: p.year,
    })),
    filters: filterable ? categories.map((c) => ({ key: categoryKey(c), label: c })) : [],
    active: active ? categoryKey(active) : null,
    projectsEmail: emails.projects,
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Work — VORA" }];
}

const pad = (n: number) => String(n).padStart(2, "0");

export default function Work({ loaderData }: Route.ComponentProps) {
  const { projects, total, filters, active, projectsEmail } = loaderData;
  return (
    <>
      <header className="v-opening v-container" data-reveal="">
        <div className="v-opening__meta">
          <Label fade>Work</Label>
          <Label fade i={1}>
            {pad(total)} {total === 1 ? "project" : "projects"}
          </Label>
        </div>
        <Lines as="h1" className="v-display-l" lines={["Work"]} />
        <p className="v-lead v-fade">
          <Slot>Work lead — one sentence, copy slot</Slot>
        </p>
      </header>

      {filters.length > 0 ? (
        <nav className="v-container" aria-label="Filter projects by category">
          <div className="v-filters-bar">
            <SiteLink to="/work" aria-current={active ? undefined : "true"}>
              All
            </SiteLink>
            {filters.map((f) => (
              <SiteLink
                key={f.key}
                to={`/work?category=${f.key}`}
                aria-current={active === f.key ? "true" : undefined}
              >
                {f.label}
              </SiteLink>
            ))}
          </div>
        </nav>
      ) : null}

      <section
        className="v-container v-container--wide"
        aria-label="Projects"
        style={{ paddingBottom: "var(--section-m)" }}
      >
        {projects.length === 0 ? (
          <div className="v-container" style={{ paddingInline: 0 }}>
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
          </div>
        ) : projects.length < TILES_FROM ? (
          <div className="v-features">
            {projects.map((p, i) => (
              <ProjectFeature
                key={p.slug}
                project={p}
                index={i + 1}
                total={projects.length}
                align={i % 2 === 0 ? "left" : "right"}
                priority={i === 0}
              />
            ))}
          </div>
        ) : (
          <div className="v-stack" style={{ gap: "var(--section-s)" }}>
            <ProjectTiles projects={projects} />
            {projects.length >= INDEX_FROM ? <ProjectRows projects={projects} /> : null}
          </div>
        )}
      </section>

      <Invitation line={<Slot>Work invitation — copy slot</Slot>} email={projectsEmail} />
    </>
  );
}
