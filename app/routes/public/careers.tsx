import { load } from "~/.server/guards";
import { listOpenRoles } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { CareerList } from "~/components/vora/careers";
import {
  EmptyState,
  Invitation,
  Label,
  Lines,
  SectionHeader,
  Slot,
} from "~/components/vora/primitives";
import type { Route } from "./+types/careers";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [roles, emails] = await Promise.all([
    listOpenRoles(server),
    getSetting(server, "contact.emails"),
  ]);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    careersEmail: emails.careers,
    roles: roles.map((r) => ({
      slug: String(r.slug ?? ""),
      title: String(r.title ?? ""),
      employmentType: str(r.employmentType),
      locationType: str(r.locationType),
      locationText: str(r.locationText),
    })),
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Careers — VORA" }];
}

/** The Mark4 values (real), set as a typographic triptych. */
const VALUES = ["Craft", "Taste", "Reliability"] as const;

/** Careers (§16.9): values → published roles only → the honest empty state → introduce yourself. */
export default function Careers({ loaderData }: Route.ComponentProps) {
  const { roles, careersEmail } = loaderData;
  return (
    <>
      <header className="v-opening v-container" data-reveal="">
        <Label fade>Careers</Label>
        <Lines as="h1" className="v-display-l" lines={["Careers"]} />
        <p className="v-lead v-fade">
          <Slot>Careers lead — one sentence, copy slot</Slot>
        </p>
      </header>

      <section className="v-container v-section--s" aria-label="Values">
        <ul className="v-triptych" data-reveal="">
          {VALUES.map((value, i) => (
            <li key={value}>
              <span className="v-label">{String(i + 1).padStart(2, "0")}</span>
              <span className="v-triptych__word">{value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="v-container v-section--s" aria-labelledby="roles">
        <div className="v-stack" style={{ gap: "var(--space-7)" }}>
          <SectionHeader
            id="roles"
            label="Open roles"
            title={["Open roles"]}
            titleClass="v-heading-l"
          />
          {roles.length === 0 ? (
            <EmptyState>
              <p className="v-body">There are no open roles right now.</p>
              <p className="v-body-s">
                You can still introduce yourself at{" "}
                <a className="v-link" href={`mailto:${careersEmail}`}>
                  {careersEmail}
                </a>
                .
              </p>
            </EmptyState>
          ) : (
            <CareerList roles={roles} />
          )}
        </div>
      </section>

      <Invitation
        label="Next — Introduce yourself"
        line={<Slot>Careers invitation — copy slot</Slot>}
        action={null}
        email={careersEmail}
      />
    </>
  );
}
