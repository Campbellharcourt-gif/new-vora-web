import type { ReactNode } from "react";
import { Form, Link, NavLink } from "react-router";
import { Logo } from "~/components/ui/Logo";
import styles from "./workspace.module.css";

export interface WorkspaceNavItem {
  to: string;
  label: string;
  end?: boolean;
}

/** Shared shell for account, admin, client and member areas (workspace theme). */
export function WorkspaceShell(props: {
  area: string;
  nav: WorkspaceNavItem[];
  user: { name: string; email: string };
  switchTo?: WorkspaceNavItem[];
  children: ReactNode;
}) {
  return (
    <div data-theme="workspace" className={styles.shell}>
      {/* tabIndex={0}: keeps the skip link in Safari/WebKit's default Tab order (see the note in
          routes/public/_layout.tsx); without it the first Tab landed on "Sign out". */}
      <a className="skip-link" href="#main" tabIndex={0}>
        Skip to content
      </a>
      <header className={styles.top}>
        <Link to="/" className={styles.brand} aria-label="VORA — public site">
          <Logo variant="on-light" title="" size="s" />
        </Link>
        <span className={styles.area}>{props.area}</span>
        <div className={styles.user}>
          <span className={styles.userName}>{props.user.name}</span>
          <Form method="post" action="/logout">
            <button type="submit" className={styles.linkButton}>
              Sign out
            </button>
          </Form>
        </div>
      </header>
      <div className={styles.body}>
        <nav aria-label={`${props.area} navigation`} className={styles.side}>
          <ul>
            {props.nav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? styles.active : undefined)}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          {props.switchTo && props.switchTo.length > 0 ? (
            <ul className={styles.switch}>
              {props.switchTo.map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </nav>
        <main id="main" className={styles.main}>
          {props.children}
        </main>
      </div>
    </div>
  );
}

export function PageHeading({
  title,
  description,
  eyebrow,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
}) {
  return (
    <header className={styles.heading}>
      {eyebrow ? <p className="label">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p className="muted">{description}</p> : null}
    </header>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={styles.panel} aria-label={title}>
      {title || actions ? (
        <div className={styles.panelHead}>
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
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
