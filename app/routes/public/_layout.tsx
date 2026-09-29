import { Outlet, useMatches, useRouteLoaderData } from "react-router";
import { publicAssistantAvailability } from "~/.server/ai/assistant";
import { load } from "~/.server/guards";
import { listVisibleSocialLinks } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import displayFont from "~/assets/fonts/Archivo-SemiExpanded-Latin.woff2?url";
import { AskVoraProvider } from "~/components/site/AskVora";
import { SiteFooter } from "~/components/site/SiteFooter";
import { type SiteChrome, SiteHeader } from "~/components/site/SiteHeader";
import { useFocusHeadingOnNavigate, useReveal } from "~/components/vora/reveal";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/_layout";

export async function loader({ context }: Route.LoaderArgs) {
  const { server, actor } = load(context);
  const [socials, emails, identity, assistant] = await Promise.all([
    listVisibleSocialLinks(server, "footer"),
    getSetting(server, "contact.emails"),
    getSetting(server, "site.identity"),
    publicAssistantAvailability(server, actor),
  ]);
  return {
    assistant,
    socials: socials.map((s) => ({ url: s.url, label: s.label })),
    emails: { general: emails.general, projects: emails.projects },
    partnerLine: identity.partnerLine,
  };
}

/** The display cut sets every public page's first headline, so it loads with Archivo. */
export const links: Route.LinksFunction = () => [
  { rel: "preload", href: displayFont, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
];

/** The existing destinations, order unchanged (design system §5.1). */
const NAV = [
  { to: "/work", label: "Work" },
  { to: "/services", label: "Services" },
  { to: "/our-story", label: "Our Story" },
  { to: "/partners", label: "Partners" },
  { to: "/careers", label: "Careers" },
] as const;

/**
 * Pages declare a whole-page theme with `handle = { theme: "mist" }` (Partners, legal) and the
 * reading-progress rule with `handle = { reading: true }` (case studies, legal).
 */
function usePageHandle(): { theme: "basalt" | "mist"; reading: boolean } {
  const matches = useMatches();
  const last = matches[matches.length - 1];
  const handle = last?.handle as { theme?: string; reading?: boolean } | undefined;
  return { theme: handle?.theme === "mist" ? "mist" : "basalt", reading: Boolean(handle?.reading) };
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const { theme, reading } = usePageHandle();
  useReveal("main");
  useFocusHeadingOnNavigate("main");
  const chrome: SiteChrome = {
    nav: NAV,
    emails: loaderData.emails,
    socials: loaderData.socials,
    signedIn: Boolean(root?.user),
    accountHref: "/account",
  };
  return (
    <AskVoraProvider
      available={loaderData.assistant.available}
      maxInputChars={loaderData.assistant.maxInputChars}
    >
      {/* tabIndex={0}: Safari/WebKit leave links out of the Tab order unless "Press Tab to
          highlight each item" is switched on, so without it the first Tab skipped this link and
          landed on the Menu button. An explicit tabindex keeps the skip link the first Tab stop
          there too; other browsers already treat it this way. */}
      <a className="skip-link" href="#main" tabIndex={0}>
        Skip to content
      </a>
      <SiteHeader chrome={chrome} pageTheme={theme} reading={reading} />
      <main id="main" className="v-main" data-theme={theme === "mist" ? "mist" : undefined}>
        <Outlet />
      </main>
      <SiteFooter chrome={chrome} partnerLine={loaderData.partnerLine} />
    </AskVoraProvider>
  );
}
