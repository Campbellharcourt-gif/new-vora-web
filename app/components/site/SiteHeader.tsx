import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigation } from "react-router";
import { Logo } from "~/components/ui/Logo";
import { ArrowRight } from "~/components/vora/icons";
import { ButtonLink, SurveyLine } from "~/components/vora/primitives";
import { prefersReducedMotion } from "~/components/vora/reveal";
import { AskVoraButton } from "./AskVora";

/**
 * The public header (design system §5.1–§5.5): wordmark, the five destinations, the Start a
 * project button; a text Menu button below 1024 px opening the full-screen menu dialog.
 * Without JavaScript the menu is the server-rendered <details> that existed before.
 */

export interface NavItem {
  to: string;
  label: string;
}

export interface SiteChrome {
  nav: readonly NavItem[];
  emails: { general: string; projects: string };
  socials: readonly { url: string; label: string }[];
  signedIn: boolean;
  accountHref: string;
}

function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/**
 * Scroll states set directly on the element (no re-render per scroll): resting at the top,
 * "scrolled" after one header height, hidden while scrolling down past two header heights and
 * revealed by any upward scroll of 8 px or more. Over a Mist section the header takes the Mist
 * roles. Reduced motion keeps it in place (CSS).
 */
function useHeaderBehaviour(ref: React.RefObject<HTMLElement | null>, pageTheme: string) {
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scan the page's Mist sections per route
  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    let lastY = window.scrollY;
    let frame = 0;
    const mistSections = Array.from(
      document.querySelectorAll<HTMLElement>("#main [data-theme='mist']"),
    );
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const h = header.offsetHeight;
      header.dataset.scroll = y > h ? "scrolled" : "top";
      if (y <= h * 2 || prefersReducedMotion()) header.dataset.hidden = "false";
      else if (y > lastY + 2) header.dataset.hidden = "true";
      else if (y < lastY - 8) header.dataset.hidden = "false";
      if (Math.abs(y - lastY) > 2 || y <= h * 2) lastY = y;
      // The reading-progress rule on long reads (case studies, legal pages).
      if (header.hasAttribute("data-reading")) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        header.style.setProperty("--read", String(max > 0 ? Math.min(1, y / max) : 0));
      }
      if (pageTheme !== "mist") {
        const line = h;
        const overMist = mistSections.some((section) => {
          const rect = section.getBoundingClientRect();
          return rect.top <= line && rect.bottom > line;
        });
        if (overMist) header.dataset.theme = "mist";
        else delete header.dataset.theme;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, pageTheme, location.pathname]);
}

/** Route loading: nothing for 150 ms, then the survey line sweeps along the header edge. */
function RouteProgress() {
  const navigation = useNavigation();
  const [visible, setVisible] = useState(false);
  const busy = navigation.state === "loading";
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, [busy]);
  return visible ? (
    <SurveyLine variant="sweep" label="Loading the page" className="v-header__progress" />
  ) : null;
}

function MenuContents({
  chrome,
  pathname,
  top,
  onNavigate,
}: {
  chrome: SiteChrome;
  pathname: string;
  top: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="v-menu__top">{top}</div>
      <ul className="v-menu__list">
        {chrome.nav.map((item, i) => {
          const current = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                viewTransition
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
              >
                <span className="v-menu__index">{String(i + 1).padStart(2, "0")}</span>
                <span className="v-mask">
                  <span className="v-menu__item" style={{ "--i": i } as React.CSSProperties}>
                    {item.label}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        to="/contact"
        viewTransition
        onClick={onNavigate}
        className="v-btn v-btn--primary v-btn--block"
      >
        Start a project
        <ArrowRight />
      </Link>
      <p style={{ marginTop: "var(--space-4)" }}>
        <AskVoraButton onBeforeOpen={onNavigate} />
      </p>
      <div className="v-menu__foot">
        <div className="v-stack" style={{ gap: "var(--space-2)" }}>
          <p className="v-label">Email</p>
          <a className="v-link v-body-s" href={`mailto:${chrome.emails.general}`}>
            {chrome.emails.general}
          </a>
          <a className="v-link v-body-s" href={`mailto:${chrome.emails.projects}`}>
            {chrome.emails.projects}
          </a>
        </div>
        {chrome.socials.length > 0 ? (
          <div className="v-stack" style={{ gap: "var(--space-2)" }}>
            <p className="v-label">Follow</p>
            {chrome.socials.map((s) => (
              <a
                key={s.url}
                className="v-link v-body-s"
                href={s.url}
                rel="noopener noreferrer me"
                target="_blank"
              >
                {s.label}
                <span className="v-sr"> (opens in a new tab)</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <p className="v-menu__small">
        <Link to="/status" onClick={onNavigate}>
          Status
        </Link>
        <Link to="/terms" onClick={onNavigate}>
          Terms
        </Link>
        <Link to="/privacy" onClick={onNavigate}>
          Privacy
        </Link>
        <Link to="/cookies" onClick={onNavigate}>
          Cookies
        </Link>
        <Link to={chrome.signedIn ? chrome.accountHref : "/login"} onClick={onNavigate}>
          {chrome.signedIn ? "Account" : "Sign in"}
        </Link>
      </p>
    </>
  );
}

const INERT_TARGETS = ["#main", "#site-footer", "#site-header"];

/** The enhanced menu: a modal dialog with the page behind inert and scroll-locked (§5.4). */
function MenuDialog({
  chrome,
  pathname,
  onClose,
  closing,
}: {
  chrome: SiteChrome;
  pathname: string;
  onClose: () => void;
  closing: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const others = INERT_TARGETS.map((s) => document.querySelector<HTMLElement>(s)).filter(
      (el): el is HTMLElement => Boolean(el),
    );
    for (const el of others) el.inert = true;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    dialog?.querySelector<HTMLElement>(".v-menu__list a")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab" && dialog) {
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of others) el.inert = false;
      root.style.overflow = previousOverflow;
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      id="site-menu"
      className="v-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      data-state={closing ? "closing" : "open"}
    >
      <MenuContents
        chrome={chrome}
        pathname={pathname}
        onNavigate={onClose}
        top={
          <>
            <Link to="/" viewTransition onClick={onClose} aria-label="VORA — home">
              <Logo title="" />
            </Link>
            <button type="button" className="v-menu-btn" onClick={onClose}>
              Close
            </button>
          </>
        }
      />
    </div>
  );
}

export function SiteHeader({
  chrome,
  pageTheme,
  reading,
}: {
  chrome: SiteChrome;
  pageTheme: string;
  reading?: boolean;
}) {
  const hydrated = useHydrated();
  const location = useLocation();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<"closed" | "open" | "closing">("closed");
  useHeaderBehaviour(headerRef, pageTheme);

  const close = useCallback(() => {
    setMenu((state) => (state === "open" ? "closing" : state));
  }, []);

  // Close: 320 ms (a 120 ms fade in reduced motion), then focus returns to the Menu button —
  // after the dialog has unmounted and the page is no longer inert.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (menu === "closing") {
      const timer = window.setTimeout(
        () => {
          returnFocus.current = true;
          setMenu("closed");
        },
        prefersReducedMotion() ? 120 : 320,
      );
      return () => window.clearTimeout(timer);
    }
    if (menu === "closed" && returnFocus.current) {
      returnFocus.current = false;
      menuButtonRef.current?.focus();
    }
  }, [menu]);

  // A destination closes the menu as the page changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change only
  useEffect(() => {
    setMenu("closed");
  }, [location.pathname]);

  const onContact = location.pathname === "/contact";

  return (
    <>
      <header
        id="site-header"
        ref={headerRef}
        className="v-header"
        data-theme={pageTheme === "mist" ? "mist" : undefined}
        data-reading={reading ? "" : undefined}
      >
        <Link to="/" viewTransition className="v-brand-link" aria-label="VORA — home">
          <Logo title="" />
        </Link>
        <nav aria-label="Primary" className="v-nav">
          <ul>
            {chrome.nav.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} viewTransition>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <AskVoraButton />
          <ButtonLink to="/contact" variant="secondary" size="s" current={onContact}>
            Start a project
          </ButtonLink>
        </nav>
        <div className="v-header__end">
          <ButtonLink
            to="/contact"
            variant="secondary"
            size="s"
            className="v-header__cta"
            current={onContact}
          >
            Start a project
          </ButtonLink>
          {hydrated ? (
            <button
              ref={menuButtonRef}
              type="button"
              className="v-menu-btn"
              aria-expanded={menu === "open"}
              aria-controls="site-menu"
              onClick={() => setMenu("open")}
            >
              Menu
            </button>
          ) : (
            <details className="v-menu-details">
              <summary className="v-menu-btn">
                <span className="v-menu-details__open">Menu</span>
                <span className="v-menu-details__close">Close</span>
              </summary>
              <div className="v-menu">
                <MenuContents
                  chrome={chrome}
                  pathname={location.pathname}
                  top={<Logo title="VORA" />}
                />
              </div>
            </details>
          )}
        </div>
        {reading ? <span className="v-header__reading" aria-hidden="true" /> : null}
        <RouteProgress />
      </header>
      {menu !== "closed" ? (
        <MenuDialog
          chrome={chrome}
          pathname={location.pathname}
          onClose={close}
          closing={menu === "closing"}
        />
      ) : null}
    </>
  );
}
