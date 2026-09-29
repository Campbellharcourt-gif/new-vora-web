import { load } from "~/.server/guards";
import { listPublishedServices } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import {
  EmptyState,
  Invitation,
  Label,
  Lines,
  SectionHeader,
  SiteLink,
  Slot,
} from "~/components/vora/primitives";
import { ProcessLine, ServiceList } from "~/components/vora/services";
import type { Route } from "./+types/services";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [services, identity, emails] = await Promise.all([
    listPublishedServices(server),
    getSetting(server, "site.identity"),
    getSetting(server, "contact.emails"),
  ]);
  return {
    services: services.map((s) => ({
      slug: String(s.slug ?? ""),
      name: String(s.name ?? ""),
      summary: typeof s.summary === "string" ? s.summary : null,
      deliveryModel: String(s.deliveryModel ?? "vora"),
    })),
    partnerLine: identity.partnerLine,
    projectsEmail: emails.projects,
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Services — VORA" }];
}

/** Services (§16.4): what VORA does, and exactly who delivers each discipline (C2/D4). */
export default function Services({ loaderData }: Route.ComponentProps) {
  const { services, partnerLine, projectsEmail } = loaderData;
  return (
    <>
      <header className="v-opening v-container" data-reveal="">
        <Label fade>Services</Label>
        <Lines as="h1" className="v-display-l" lines={["Services"]} />
        <p className="v-lead v-fade">
          <Slot>Services lead — one sentence, copy slot</Slot>
        </p>
        {partnerLine ? (
          <Label fade i={2}>
            {partnerLine}
          </Label>
        ) : null}
      </header>

      <section className="v-container" aria-label="What VORA does">
        {services.length === 0 ? (
          <EmptyState>
            <p className="v-body">Service details are being prepared.</p>
            <p className="v-body-s">
              In the meantime,{" "}
              <SiteLink className="v-link" to="/contact">
                tell us about your project
              </SiteLink>
              .
            </p>
          </EmptyState>
        ) : (
          <ServiceList services={services} />
        )}
      </section>

      <section className="v-container v-section" aria-labelledby="process">
        <div className="v-stack" style={{ gap: "var(--space-8)" }}>
          <SectionHeader
            id="process"
            label="Process"
            title={["How we work"]}
            titleClass="v-heading-l"
          />
          <ProcessLine />
        </div>
      </section>

      <Invitation line={<Slot>Services invitation — copy slot</Slot>} email={projectsEmail} />
    </>
  );
}
