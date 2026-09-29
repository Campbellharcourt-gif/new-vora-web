import type { CSSProperties } from "react";
import { load } from "~/.server/guards";
import {
  listPublishedPartners,
  listPublishedServicesForPartner,
} from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import {
  ButtonLink,
  EmptyState,
  ExternalLink,
  Label,
  Lines,
  SectionHeader,
  SiteLink,
  Slot,
  statementLines,
} from "~/components/vora/primitives";
import { ServiceList } from "~/components/vora/services";
import type { Route } from "./+types/partners";

/** The whole page takes the Mist roles (§16.7). */
export const handle = { theme: "mist" };

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [partners, identity, emails] = await Promise.all([
    listPublishedPartners(server),
    getSetting(server, "site.identity"),
    getSetting(server, "contact.emails"),
  ]);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const list = partners.map((p) => ({
    slug: String(p.slug ?? ""),
    name: String(p.name ?? ""),
    relationship: str(p.relationship),
    description: str(p.description),
    statement: str(p.statement),
    url: str(p.url),
  }));
  const together = await Promise.all(
    list.map(async (p) => ({
      partner: p.slug,
      services: (await listPublishedServicesForPartner(server, p.slug)).map((s) => ({
        slug: String(s.slug ?? ""),
        name: String(s.name ?? ""),
        summary: typeof s.summary === "string" ? s.summary : null,
        deliveryModel: String(s.deliveryModel ?? "partner"),
      })),
    })),
  );
  return {
    partners: list,
    together,
    statement: list[0]?.statement ?? identity.partnerLine,
    generalEmail: emails.general,
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Partners — VORA" }];
}

/** Clear roles / One experience / Shared standards — real, from Mark4; bodies are slots. */
const PRINCIPLES = ["Clear roles", "One experience", "Shared standards"] as const;

/**
 * Partners (§16.7, a Mist page): the statement, the partner entry, the three principles, the
 * services delivered together (derived from the data) and partnership enquiries. The
 * partnership is shown in VORA's visual language — no Solara colours, type or imagery.
 */
export default function Partners({ loaderData }: Route.ComponentProps) {
  const { partners, together, statement, generalEmail } = loaderData;
  return (
    <>
      <header className="v-opening v-container" data-reveal="">
        <Label fade>Partners</Label>
        <Lines
          as="h1"
          className="v-display-l"
          lines={statement ? statementLines(statement) : ["Partners"]}
        />
      </header>

      {partners.length === 0 ? (
        <div className="v-container" style={{ paddingBottom: "var(--section-m)" }}>
          <EmptyState>
            <p className="v-body">Partnership details are being prepared.</p>
            <p className="v-body-s">
              Interested in partnering with VORA?{" "}
              <SiteLink className="v-link" to="/contact">
                Get in touch
              </SiteLink>
              .
            </p>
          </EmptyState>
        </div>
      ) : (
        partners.map((p) => {
          const services = together.find((t) => t.partner === p.slug)?.services ?? [];
          return (
            <section
              key={p.slug}
              className="v-container v-section--s v-partner"
              aria-labelledby={`partner-${p.slug}`}
            >
              <div className="v-sechead" data-reveal="">
                <Label fade>{p.relationship ?? "Partner"}</Label>
                <div className="v-sechead__body">
                  <Lines
                    as="h2"
                    id={`partner-${p.slug}`}
                    className="v-heading-l"
                    lines={[p.name]}
                  />
                  {p.description ? (
                    <p className="v-lead v-fade" style={{ "--i": 1 } as CSSProperties}>
                      {p.description}
                    </p>
                  ) : null}
                  {p.url ? (
                    <p className="v-fade" style={{ "--i": 2 } as CSSProperties}>
                      <ExternalLink href={p.url}>Visit {p.name}</ExternalLink>
                    </p>
                  ) : null}
                </div>
              </div>

              <ul className="v-principles" aria-label="How the partnership works">
                {PRINCIPLES.map((principle, i) => (
                  <li key={principle} data-reveal="">
                    <span className="v-label">{String(i + 1).padStart(2, "0")}</span>
                    <span className="v-heading-m">{principle}</span>
                    <span className="v-body-s">
                      <Slot>{principle} — principle copy slot</Slot>
                    </span>
                  </li>
                ))}
              </ul>

              {services.length > 0 ? (
                <div className="v-stack" style={{ gap: "var(--space-7)" }}>
                  <SectionHeader
                    label="Delivered together"
                    title={[`With ${p.name}`]}
                    titleClass="v-heading-l"
                  />
                  <ServiceList services={services} />
                </div>
              ) : null}
            </section>
          );
        })
      )}

      <section className="v-invite v-container" data-reveal="" aria-labelledby="partner-enquiries">
        <Label fade>Partnership enquiries</Label>
        <Lines
          as="h2"
          id="partner-enquiries"
          className="v-display-m v-invite__line"
          lines={[<Slot key="slot">Partnership invitation — copy slot</Slot>]}
        />
        <div className="v-invite__actions v-fade" style={{ "--i": 1 } as CSSProperties}>
          <ButtonLink to="/contact" size="l">
            Start a project
          </ButtonLink>
          <a className="v-link v-body-s" href={`mailto:${generalEmail}`}>
            {generalEmail}
          </a>
        </div>
      </section>
    </>
  );
}
