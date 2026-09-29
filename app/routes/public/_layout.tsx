import { Link, NavLink, Outlet, useRouteLoaderData } from "react-router";
import { load } from "~/.server/guards";
import { listVisibleSocialLinks } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Logo } from "~/components/ui/Logo";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/_layout";
import styles from "./site.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [socials, emails, identity] = await Promise.all([
    listVisibleSocialLinks(server, "footer"),
    getSetting(server, "contact.emails"),
    getSetting(server, "site.identity"),
  ]);
  return { socials, emails, partnerLine: identity.partnerLine };
}

const NAV = [
  { to: "/work", label: "Work" },
  { to: "/services", label: "Services" },
  { to: "/our-story", label: "Our Story" },
  { to: "/partners", label: "Partners" },
  { to: "/careers", label: "Careers" },
];

function NavItems({
  user,
}: {
  user: { canAdmin: boolean; canClient: boolean } | null | undefined;
}) {
  return (
    <>
      {NAV.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            className={({ isActive }) => (isActive ? styles.active : undefined)}
          >
            {item.label}
          </NavLink>
        </li>
      ))}
      <li>
        <NavLink to="/contact" className={styles.cta}>
          Start a project
        </NavLink>
      </li>
      {user ? (
        <li>
          <Link to={user.canAdmin ? "/admin" : user.canClient ? "/client" : "/account"}>
            Your account
          </Link>
        </li>
      ) : null}
    </>
  );
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const user = root?.user;
  const year = new Date().getFullYear();
  return (
    <>
      {/* tabIndex={0}: Safari/WebKit leave links out of the Tab order unless "Press Tab to
          highlight each item" is switched on, so without it the first Tab skipped this link and
          landed on the Menu button. An explicit tabindex keeps the skip link the first Tab stop
          there too; other browsers already treat it this way. */}
      <a className="skip-link" href="#main" tabIndex={0}>
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <Link to="/" className={styles.brand} aria-label="VORA — home">
            <Logo title="" />
          </Link>
          <nav aria-label="Primary" className={styles.nav}>
            <ul className={styles.desktopNav}>
              <NavItems user={user} />
            </ul>
            <details className={styles.menu}>
              <summary className={styles.menuButton}>Menu</summary>
              <ul className={styles.navList}>
                <NavItems user={user} />
              </ul>
            </details>
          </nav>
        </div>
      </header>

      <main id="main" className={styles.main}>
        <Outlet />
      </main>

      <footer className={styles.footer}>
        <div className={`container ${styles.footerGrid}`}>
          <div className="stack">
            <Logo title="VORA" size="s" />
            {loaderData.partnerLine ? <p className="muted">{loaderData.partnerLine}</p> : null}
          </div>
          <nav aria-label="Footer" className={styles.footerNav}>
            <ul>
              {NAV.map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
              <li>
                <Link to="/contact">Contact</Link>
              </li>
            </ul>
            <ul>
              <li>
                <a href={`mailto:${loaderData.emails.general}`}>{loaderData.emails.general}</a>
              </li>
              <li>
                <a href={`mailto:${loaderData.emails.projects}`}>{loaderData.emails.projects}</a>
              </li>
              {loaderData.socials.map((s) => (
                <li key={s.url}>
                  <a href={s.url} rel="noopener noreferrer me" target="_blank">
                    {s.label}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
            <ul>
              <li>
                <Link to="/privacy">Privacy</Link>
              </li>
              <li>
                <Link to="/terms">Terms</Link>
              </li>
              <li>
                <Link to="/cookies">Cookies</Link>
              </li>
              <li>
                <Link to="/status">Status</Link>
              </li>
              <li>
                <Link to={user ? "/account" : "/login"}>{user ? "Account" : "Sign in"}</Link>
              </li>
            </ul>
          </nav>
          <p className={`${styles.legal} label`}>© {year} VORA</p>
        </div>
      </footer>
    </>
  );
}
