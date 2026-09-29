import { Link } from "react-router";
import { Logo } from "~/components/ui/Logo";
import type { SiteChrome } from "./SiteHeader";

/**
 * The footer (design system §5.6): wordmark and partner line, the site links, the contact
 * addresses and social links, then legal, status and sign-in. No back-to-top, no newsletter, no
 * giant cropped wordmark. The Motion toggle waits for approval of its `vora_motion` cookie
 * (Appendix C) — until then the OS setting alone chooses the reduced-motion version.
 */
export function SiteFooter({
  chrome,
  partnerLine,
}: {
  chrome: SiteChrome;
  partnerLine: string | null;
}) {
  const year = new Date().getFullYear();
  return (
    <footer id="site-footer" className="v-footer">
      <div className="v-container">
        <div className="v-footer__grid">
          <div className="v-footer__brand">
            <Logo title="VORA" />
            {partnerLine ? <p className="v-body-s">{partnerLine}</p> : null}
          </div>
          <nav className="v-footer__col" aria-label="Footer">
            <p className="v-label">Site</p>
            {chrome.nav.map((item) => (
              <Link key={item.to} to={item.to} viewTransition>
                {item.label}
              </Link>
            ))}
            <Link to="/contact" viewTransition>
              Contact
            </Link>
          </nav>
          <div className="v-footer__col v-footer__col--wide">
            <p className="v-label">Contact</p>
            <a href={`mailto:${chrome.emails.general}`}>{chrome.emails.general}</a>
            <a href={`mailto:${chrome.emails.projects}`}>{chrome.emails.projects}</a>
            {chrome.socials.map((s) => (
              <a key={s.url} href={s.url} rel="noopener noreferrer me" target="_blank">
                {s.label}
                <span className="v-sr"> (opens in a new tab)</span>
              </a>
            ))}
          </div>
          <div className="v-footer__col v-footer__col--wide">
            <p className="v-label">Legal &amp; system</p>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/cookies">Cookies</Link>
            <Link to="/status">Status</Link>
            <Link to={chrome.signedIn ? chrome.accountHref : "/login"}>
              {chrome.signedIn ? "Account" : "Sign in"}
            </Link>
          </div>
        </div>
        <div className="v-footer__base">
          <p className="v-label">© {year} VORA</p>
        </div>
      </div>
    </footer>
  );
}
