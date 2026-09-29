import { type ReactNode, useEffect, useRef, useState } from "react";
import { Form, Link, NavLink, useLocation } from "react-router";
import { Logo } from "~/components/ui/Logo";

export interface WorkspaceNavItem {
  to: string;
  label: string;
  end?: boolean;
}

/**
 * The portal frame (design system §11, WorkspaceShell): always the Mist/workspace roles, a
 * 240 px sidebar with the area label, the permission-filtered navigation, the switch-to links,
 * Back to site and Sign out; below 1024 px the sidebar is a drawer (a modal dialog: focus trap,
 * Esc, focus return) opened from the Menu button. Usability first: motion is feedback only
 * (≤ 320 ms), no reveals, no page-transition choreography.
 */
export function WorkspaceShell(props: {
  area: string;
  nav: WorkspaceNavItem[];
  user: { name: string; email: string };
  switchTo?: WorkspaceNavItem[];
  children: ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  useEffect(() => setHydrated(true), []);
  // Choosing a destination closes the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change only
  useEffect(() => {
    if (drawer.current?.open) drawer.current.close();
  }, [location.pathname]);

  const sidebar = (idPrefix: string) => (
    <div className="v-ws__sideinner">
      <div className="v-ws__brand">
        <Link to="/" className="v-brand-link" aria-label="VORA — public site">
          <Logo title="" />
        </Link>
        <span className="v-label">{props.area}</span>
      </div>
      <nav aria-label={`${props.area} navigation`}>
        <ul className="v-ws__nav">
          {props.nav.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {props.switchTo && props.switchTo.length > 0 ? (
        <nav className="v-ws__group" aria-labelledby={`${idPrefix}-switch`}>
          <p className="v-label" id={`${idPrefix}-switch`}>
            Switch to
          </p>
          <ul className="v-ws__nav">
            {props.switchTo.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <div className="v-ws__foot">
        <Link className="v-link" to="/">
          Back to site
        </Link>
        <Form method="post" action="/logout">
          <button type="submit" className="v-linkbutton">
            Sign out
          </button>
        </Form>
        <span className="v-body-s">Signed in as {props.user.name}</span>
      </div>
    </div>
  );

  return (
    <div data-theme="workspace" className="v-ws">
      {/* tabIndex={0}: keeps the skip link in Safari/WebKit's default Tab order (see the note in
          routes/public/_layout.tsx); without it the first Tab landed on "Sign out". */}
      <a className="skip-link" href="#main" tabIndex={0}>
        Skip to content
      </a>
      <aside className="v-ws__side" aria-label={props.area}>
        {sidebar("side")}
      </aside>
      <div className="v-ws__main">
        <div className="v-ws__bar">
          {hydrated ? (
            <button
              type="button"
              className="v-btn v-btn--secondary v-btn--s"
              aria-haspopup="dialog"
              aria-controls="ws-drawer"
              onClick={() => drawer.current?.showModal()}
            >
              Menu
            </button>
          ) : (
            <details className="v-ws__nojs">
              <summary className="v-btn v-btn--secondary v-btn--s">Menu</summary>
              <div className="v-ws__nojs-panel">{sidebar("nojs")}</div>
            </details>
          )}
          <span className="v-label">{props.area}</span>
        </div>
        <main id="main" className="v-ws__content">
          {props.children}
        </main>
      </div>
      {hydrated ? (
        <dialog ref={drawer} id="ws-drawer" className="v-ws__drawer" aria-label="Menu">
          <div className="v-ws__drawerhead">
            <form method="dialog">
              <button type="submit" className="v-btn v-btn--quiet">
                Close
              </button>
            </form>
          </div>
          {sidebar("drawer")}
        </dialog>
      ) : null}
    </div>
  );
}

/**
 * The page's top bar: breadcrumbs (detail pages) or the area label, the title (heading-m), an
 * optional description and the page's primary action on the right.
 */
export function PageHeading({
  title,
  description,
  eyebrow,
  crumbs,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  crumbs?: { to: string; label: string }[];
  actions?: ReactNode;
}) {
  return (
    <>
      <header className="v-ws__top">
        <div className="v-ws__titles">
          {crumbs && crumbs.length > 0 ? (
            <nav aria-label="Breadcrumb">
              <ol className="v-ws__crumbs">
                {crumbs.map((c) => (
                  <li key={c.to}>
                    <Link to={c.to}>{c.label}</Link>
                  </li>
                ))}
                <li aria-current="page">{title}</li>
              </ol>
            </nav>
          ) : eyebrow ? (
            <p className="v-label">{eyebrow}</p>
          ) : null}
          <h1>{title}</h1>
        </div>
        {actions ? <div className="v-ws__actions">{actions}</div> : null}
      </header>
      {description ? <p className="v-body-s">{description}</p> : null}
    </>
  );
}

/** A flat panel: white surface, 1 px line, radius-s, a label heading row. No shadows. */
export function Panel({
  title,
  children,
  actions,
  flush,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Tables fill the panel edge to edge. */
  flush?: boolean;
}) {
  return (
    <section className="v-panel" aria-label={title}>
      {title || actions ? (
        <div className="v-panel__head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {flush ? children : <div className="v-panel__body">{children}</div>}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="v-empty" style={{ borderTop: 0 }}>
      <p className="v-body">{children}</p>
    </div>
  );
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const formatted = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(ms);
  return `${formatted} UTC`;
}
