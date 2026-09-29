import { ArrowRight } from "./icons";
import { SiteLink } from "./primitives";

/** CareerRow (design system §7.8): published roles only; the whole row is one link. */

export interface RoleCard {
  slug: string;
  title: string;
  employmentType: string | null;
  locationType: string | null;
  locationText: string | null;
}

const EMPLOYMENT: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Internship",
};
const LOCATION: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };

export function roleFacts(r: Omit<RoleCard, "slug" | "title">): string[] {
  return [
    r.locationType ? (LOCATION[r.locationType] ?? null) : null,
    r.employmentType ? (EMPLOYMENT[r.employmentType] ?? null) : null,
    r.locationText,
  ].filter((v): v is string => Boolean(v));
}

export function CareerList({ roles }: { roles: readonly RoleCard[] }) {
  return (
    <ul className="v-careers">
      {roles.map((r) => (
        <li className="v-career" key={r.slug} data-reveal="">
          <SiteLink to={`/careers/${r.slug}`}>
            <span className="v-heading-m">{r.title}</span>
            <span className="v-career__facts">
              {roleFacts(r).map((fact) => (
                <span className="v-label" key={fact}>
                  {fact}
                </span>
              ))}
            </span>
            <ArrowRight />
          </SiteLink>
        </li>
      ))}
    </ul>
  );
}
