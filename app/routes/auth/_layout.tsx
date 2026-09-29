import { Link, Outlet } from "react-router";
import { Logo } from "~/components/ui/Logo";
import styles from "./auth.module.css";

export default function AuthLayout() {
  return (
    <div data-theme="workspace" className={styles.shell}>
      {/* tabIndex={0}: keeps the skip link in Safari/WebKit's default Tab order (see the note in
          routes/public/_layout.tsx). */}
      <a className="skip-link" href="#main" tabIndex={0}>
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to="/" aria-label="VORA — home" className={styles.brand}>
          <Logo variant="on-light" title="" />
        </Link>
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
