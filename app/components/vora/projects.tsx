import type { CSSProperties } from "react";
import {
  Aperture,
  ArrowLink,
  ExternalLink,
  Label,
  Lines,
  type MediaAsset,
  SiteLink,
} from "./primitives";

/**
 * Project components (design system §7.2): ProjectFeature, ProjectTile, ProjectRows,
 * ProjectFacts, Credits and NextProject. Published, real projects only — the pages show the
 * existing empty state when nothing is published.
 */

export interface ProjectCard {
  slug: string;
  title: string;
  category: string | null;
  summary: string | null;
  year: number | null;
  /** Delivered cover media; null until the media delivery route ships (see Aperture). */
  cover?: MediaAsset | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `CATEGORY · YEAR` — empty parts are omitted, never shown as "—". */
export function projectMeta(p: Pick<ProjectCard, "category" | "year">): string {
  return [p.category, p.year ? String(p.year) : null].filter(Boolean).join(" · ");
}

export const projectTransitionName = (slug: string) => `project-${slug}`;

/** One real project per shot: a wide aperture, the title over its lower-left edge, one link. */
export function ProjectFeature({
  project,
  index,
  total,
  align = "left",
  headingLevel = "h2",
  priority,
}: {
  project: ProjectCard;
  index: number;
  total: number;
  align?: "left" | "right";
  headingLevel?: "h2" | "h3";
  priority?: boolean;
}) {
  const meta = projectMeta(project);
  return (
    <article
      className={align === "right" ? "v-feature v-feature--right" : "v-feature"}
      data-reveal=""
    >
      <Aperture
        ratio={null}
        media={project.cover}
        plate="horizon"
        slotLabel="Cover media"
        transitionName={projectTransitionName(project.slug)}
        priority={priority}
      />
      <Lines as={headingLevel} className="v-display-l v-feature__title" lines={[project.title]} />
      <div className="v-feature__meta">
        <Label fade>
          {pad(index)} / {pad(total)}
          {meta ? ` · ${meta}` : ""}
        </Label>
        {project.summary ? (
          <p className="v-body v-fade" style={{ "--i": 1 } as CSSProperties}>
            {project.summary}
          </p>
        ) : null}
        <ArrowLink to={`/work/${project.slug}`}>
          View the project<span className="v-sr">: {project.title}</span>
        </ArrowLink>
      </div>
    </article>
  );
}

/** Work index from four projects: alternating, offset apertures — never a uniform grid. */
export function ProjectTiles({ projects }: { projects: readonly ProjectCard[] }) {
  return (
    <div className="v-tiles">
      {projects.map((p, i) => (
        <article className="v-tile" key={p.slug} data-reveal="">
          <Aperture
            ratio={i % 2 === 0 ? "3/2" : "4/5"}
            media={p.cover}
            plate="type"
            typeTitle={p.title}
            transitionName={projectTransitionName(p.slug)}
            reveal={false}
          />
          {projectMeta(p) ? <Label>{projectMeta(p)}</Label> : null}
          <h3 className="v-heading-m v-tile__title">
            <SiteLink className="v-tile__link" to={`/work/${p.slug}`}>
              <span>{p.title}</span>
            </SiteLink>
          </h3>
          {p.summary ? <p className="v-body-s">{p.summary}</p> : null}
        </article>
      ))}
    </div>
  );
}

/** The text index from six projects: index · title · category · year · → */
export function ProjectRows({ projects }: { projects: readonly ProjectCard[] }) {
  return (
    <ol className="v-projectrows" aria-label="All projects">
      {projects.map((p, i) => (
        <li key={p.slug}>
          <SiteLink to={`/work/${p.slug}`}>
            <span className="v-label">{pad(i + 1)}</span>
            <span className="v-heading-s">{p.title}</span>
            <span className="v-label">{projectMeta(p)}</span>
          </SiteLink>
        </li>
      ))}
    </ol>
  );
}

/** The case study's facts: Client · Year · Category · Services · Website. Empty fields omitted. */
export function ProjectFacts({
  clientName,
  year,
  category,
  services,
  externalUrl,
}: {
  clientName: string | null;
  year: number | null;
  category: string | null;
  services: readonly { slug: string; name: string }[];
  externalUrl: string | null;
}) {
  const host = externalUrl ? hostOf(externalUrl) : null;
  return (
    <dl className="v-facts" data-reveal="">
      {clientName ? (
        <div className="v-fade">
          <dt className="v-label">Client</dt>
          <dd>{clientName}</dd>
        </div>
      ) : null}
      {year ? (
        <div className="v-fade" style={{ "--i": 1 } as CSSProperties}>
          <dt className="v-label">Year</dt>
          <dd className="v-data">{year}</dd>
        </div>
      ) : null}
      {category ? (
        <div className="v-fade" style={{ "--i": 2 } as CSSProperties}>
          <dt className="v-label">Category</dt>
          <dd>{category}</dd>
        </div>
      ) : null}
      {services.length > 0 ? (
        <div className="v-fade" style={{ "--i": 3 } as CSSProperties}>
          <dt className="v-label">Services</dt>
          <dd>
            {services.map((s, i) => (
              <span key={s.slug}>
                {i > 0 ? ", " : null}
                <SiteLink className="v-link" to={`/services/${s.slug}`}>
                  {s.name}
                </SiteLink>
              </span>
            ))}
          </dd>
        </div>
      ) : null}
      {externalUrl && host ? (
        <div className="v-fade" style={{ "--i": 4 } as CSSProperties}>
          <dt className="v-label">Website</dt>
          <dd>
            <ExternalLink href={externalUrl}>{host}</ExternalLink>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function Credits({ credits }: { credits: readonly { role: string; name: string }[] }) {
  return (
    <dl className="v-credits">
      {credits.map((c) => (
        <div key={`${c.role}-${c.name}`}>
          <dt className="v-label">{c.role}</dt>
          <dd>{c.name}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The next published project as one full-width link (the strip morphs into its hero). */
export function NextProject({ project }: { project: ProjectCard }) {
  return (
    <nav className="v-next" aria-label="Next project" data-reveal="">
      <Label>Next project</Label>
      <Aperture
        ratio={null}
        media={project.cover}
        plate="horizon"
        slotLabel="Cover media"
        transitionName={projectTransitionName(project.slug)}
      />
      <p className="v-heading-l">
        <SiteLink className="v-next__link" to={`/work/${project.slug}`}>
          {project.title}
        </SiteLink>
      </p>
      {projectMeta(project) ? <Label>{projectMeta(project)}</Label> : null}
    </nav>
  );
}
