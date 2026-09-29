import { Link } from "react-router";
import { Logo } from "~/components/ui/Logo";
import type { Route } from "./+types/home";
import styles from "./site.module.css";

export function meta(): Route.MetaDescriptors {
  return [
    { title: "VORA — Digital studio" },
    {
      name: "description",
      content: "VORA is a digital studio building websites and digital experiences.",
    },
  ];
}

/**
 * PHASE 1 SHELL. The homepage experience (environment, camera journey, stations) is Phase 3.
 * This page intentionally carries only confirmed facts — no placeholder marketing claims.
 */
export default function Home() {
  return (
    <section className={`container ${styles.page}`} aria-labelledby="home-title">
      <div className={styles.pageHeader}>
        <h1 id="home-title">
          <Logo size="l" title="VORA" />
        </h1>
        <p className="muted">Creative by Solara. Digital by VORA.</p>
        <p>
          <Link to="/contact">Start a project</Link> · <Link to="/work">See the work</Link> ·{" "}
          <Link to="/services">Services</Link>
        </p>
      </div>
    </section>
  );
}
