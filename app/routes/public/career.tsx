import { blocksSchema } from "@shared/content/blocks";
import { data } from "react-router";
import { load } from "~/.server/guards";
import { listOpenRoles } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Blocks } from "~/components/content/Blocks";
import { roleFacts } from "~/components/vora/careers";
import { BackLink, ExternalLink, Label, Lines, SectionHeader } from "~/components/vora/primitives";
import type { Route } from "./+types/career";

export async function loader({ context, params }: Route.LoaderArgs) {
  const { server } = load(context);
  const roles = await listOpenRoles(server);
  const role = roles.find((r) => r.slug === params.slug);
  if (!role) throw data({ message: "Not found" }, { status: 404 });
  const emails = await getSetting(server, "contact.emails");
  const body = blocksSchema.safeParse(role.body);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    title: String(role.title ?? ""),
    summary: str(role.summary),
    employmentType: str(role.employmentType),
    locationType: str(role.locationType),
    locationText: str(role.locationText),
    applicationMode: String(role.applicationMode ?? "email"),
    externalUrl: str(role.externalUrl),
    careersEmail: emails.careers,
    body: body.success ? body.data : [],
  };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: loaderData ? `${loaderData.title} — Careers — VORA` : "Not found — VORA" }];
}

/** Role page (§16.9): title, facts, the body at the measure, and how to apply. */
export default function Career({ loaderData: r }: Route.ComponentProps) {
  const facts = roleFacts(r);
  return (
    <article>
      <header className="v-opening v-container" data-reveal="">
        <BackLink to="/careers">Careers</BackLink>
        <Lines as="h1" className="v-display-m" lines={[r.title]} />
        {facts.length > 0 ? (
          <div className="v-opening__meta">
            {facts.map((fact, i) => (
              <Label key={fact} fade i={i + 1}>
                {fact}
              </Label>
            ))}
          </div>
        ) : null}
        {r.summary ? <p className="v-lead v-fade">{r.summary}</p> : null}
      </header>

      {r.body.length > 0 ? (
        <div className="v-container">
          <Blocks blocks={r.body} />
        </div>
      ) : null}

      <section className="v-container v-section" aria-labelledby="apply">
        <div className="v-stack" style={{ gap: "var(--space-6)" }}>
          <SectionHeader
            id="apply"
            label="Apply"
            title={["How to apply"]}
            titleClass="v-heading-l"
            margin={false}
          />
          {r.applicationMode === "external" && r.externalUrl ? (
            <p>
              <ExternalLink href={r.externalUrl}>Apply on the hiring page</ExternalLink>
            </p>
          ) : (
            // The in-site application form (with private CV upload) ships in Phase 4/5.
            <p className="v-body">
              Email{" "}
              <a
                className="v-link"
                href={`mailto:${r.careersEmail}?subject=${encodeURIComponent(r.title)}`}
              >
                {r.careersEmail}
              </a>{" "}
              with your portfolio and a short note about you.
            </p>
          )}
        </div>
      </section>
    </article>
  );
}
