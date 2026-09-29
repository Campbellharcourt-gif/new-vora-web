import styles from "./Logo.module.css";

/**
 * THE single place the VORA mark is rendered.
 *
 * TEMPORARY: a neutral text wordmark for development only — deliberately not a designed logo.
 * When the real logo arrives (SVG master + variants), replace the body of this component with the
 * supplied artwork; every usage (header, footer, emails, loader) keeps working unchanged.
 */
export interface LogoProps {
  /** Visual size; maps to a height token. */
  size?: "s" | "m" | "l";
  /** Colour variant for light/dark surfaces (the supplied logo may provide both). */
  variant?: "on-dark" | "on-light";
  /** Accessible name. Pass "" when the logo is decorative next to visible "VORA" text. */
  title?: string;
  className?: string;
}

export function Logo({ size = "m", variant = "on-dark", title = "VORA", className }: LogoProps) {
  const classes = [styles.logo, styles[size], styles[variant], className].filter(Boolean).join(" ");
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
