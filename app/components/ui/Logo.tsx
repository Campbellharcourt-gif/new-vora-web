/**
 * THE single place the VORA mark is rendered (docs/01-ARCHITECTURE.md R2).
 *
 * Until the logo decision (D5) is made, it is the wordmark set in type — Archivo SemiExpanded
 * at ~460 with 0.24em tracking (design-system README) — never a drawn approximation of the
 * eye/star mark. When the SVG master arrives, replace the body of this component; every usage
 * (header, menu, footer, auth, portals, system pages) keeps working unchanged.
 */
export interface LogoProps {
  /** Accessible name. Pass "" when the mark sits inside a link that already names it. */
  title?: string;
  className?: string;
}

export function Logo({ title = "VORA", className }: LogoProps) {
  const classes = className ? `v-brand ${className}` : "v-brand";
  if (!title) {
    return (
      <span className={classes} aria-hidden="true" data-logo="placeholder">
        VORA
      </span>
    );
  }
  return (
    <span className={classes} role="img" aria-label={title} data-logo="placeholder">
      VORA
    </span>
  );
}
