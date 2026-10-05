import { Link, Outlet } from "react-router";
import { Logo } from "~/components/ui/Logo";

/**
 * Sign-in, verification, recovery, reset, invitation and setup (design system §16.13): Basalt,
 * one centred column (`--container-auth`), the wordmark above, the title at heading-l, no
 * imagery and no motion beyond feedback. Messages never reveal whether an account exists.
 */
export default function AuthLayout() {
  return (
    <div className="v-auth">
      {/* tabIndex={0}: keeps the skip link in Safari/WebKit's default Tab order (see the note in
          routes/public/_layout.tsx). */}
      <a className="skip-link" href="#main" tabIndex={0}>
        Skip to content
      </a>
      <header className="v-auth__top">
        <Link to="/" aria-label="VORA — home" className="v-brand-link">
          <Logo title="" />
        </Link>
      </header>
      <main id="main" className="v-auth__main">
        <Outlet />
      </main>
      <footer className="v-auth__foot">
        <nav aria-label="Legal">
          <Link to="/terms">Terms &amp; Conditions</Link>
          <span aria-hidden="true">·</span>
          <Link to="/privacy">Privacy Policy</Link>
        </nav>
      </footer>
    </div>
  );
}
