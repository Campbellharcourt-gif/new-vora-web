import type { CSSProperties, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "./icons";

/**
 * VORA primitives (docs/VORA-DESIGN-SYSTEM.md §6–§7, docs/design-system/components). They
 * render the design system's `v-*` classes from app/styles/vora.css. Content is always passed
 * in: nothing here invents copy. Where real copy is missing, callers use <Slot>.
 */

type Style = CSSProperties & Record<`--${string}`, string | number>;

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Public site links take part in View Transitions (§8.3); the portals never do. */
export function SiteLink(props: LinkProps) {
  return <Link viewTransition {...props} />;
}

/** InstrumentLabel: DM Mono, uppercase, always paired with what it describes. */
export function Label({
  children,
  as: Tag = "p",
  className,
  id,
  fade,
  i,
}: {
  children: ReactNode;
  as?: "p" | "span" | "dt" | "h2" | "h3" | "div";
  className?: string;
  id?: string;
  /** Reveal with the fade-up (labels fade in and rise 8 px, §8.4). */
  fade?: boolean;
  i?: number;
}) {
  return (
    <Tag
      id={id}
      className={cx("v-label", fade && "v-fade", className)}
      style={i ? ({ "--i": i } as Style) : undefined}
    >
      {children}
    </Tag>
  );
}

/** A copy slot: real copy is still to be written or approved (design-system README). */
export function Slot({ children }: { children: ReactNode }) {
  return (
    <span className="v-slot" data-slot="">
      {children}
    </span>
  );
}

/** One italic word or short phrase in a display or heading line (at most once per screen). */
export function Em({ children }: { children: ReactNode }) {
  return <span className="v-em">{children}</span>;
}

/**
 * A two-sentence statement set as two lines with one italic word — the partnership line
 * "Creative by Solara. Digital by VORA." (§7.5). Anything else stays one line, unchanged.
 */
export function statementLines(line: string): ReactNode[] {
  const parts = line.split(/(?<=\.)\s+/).filter(Boolean);
  if (parts.length !== 2) return [line];
  const first = parts[0] ?? "";
  const cut = first.lastIndexOf(" ");
  return [
    cut > 0 ? (
      <>
        {first.slice(0, cut + 1)}
        <Em>{first.slice(cut + 1)}</Em>
      </>
    ) : (
      first
    ),
    parts[1],
  ];
}

/** The × inside display lines, set at normal width (Archivo glyph defect, §2.1). */
export function Times() {
  return <span className="v-times">×</span>;
}

/**
 * Display text whose lines rise through masks on reveal (§8.4). Each entry is one line; the
 * visible text is complete in the HTML at first paint.
 */
export function Lines({
  lines,
  as: Tag = "h2",
  className,
  id,
  tabIndex,
  style,
}: {
  lines: readonly ReactNode[];
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  id?: string;
  tabIndex?: number;
  style?: CSSProperties;
}) {
  return (
    <Tag className={className} id={id} tabIndex={tabIndex} style={style}>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered lines
        <span className="v-mask" key={index}>
          <span style={index ? ({ "--i": index } as Style) : undefined}>{line}</span>
        </span>
      ))}
    </Tag>
  );
}

/** SurveyLine: the single 1 px hairline — divider, drawn line, progress or indeterminate. */
export function SurveyLine({
  variant = "static",
  strong,
  value,
  label,
  className,
  style,
}: {
  variant?: "static" | "draw" | "progress" | "sweep";
  strong?: boolean;
  /** 0–1, for `progress`. */
  value?: number;
  /** Accessible name for progress lines. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = cx(
    "v-survey",
    strong && "v-survey--strong",
    variant === "draw" && "v-draw",
    variant === "sweep" && "v-survey--sweep",
    className,
  );
  if (variant === "progress") {
    const v = Math.max(0, Math.min(1, value ?? 0));
    return (
      <div
        className={classes}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
        style={{ ...style, "--p": v } as Style}
      >
        <div className="v-survey__fill" />
      </div>
    );
  }
  if (variant === "sweep") {
    return <div className={classes} role="progressbar" aria-label={label} style={style} />;
  }
  return <div className={classes} aria-hidden="true" style={style} />;
}

/** A delivered media asset (dimensions, alt and focal point from the media library). */
export interface MediaAsset {
  src: string;
  width: number;
  height: number;
  alt: string;
  focalX?: number | null;
  focalY?: number | null;
  /** Art-directed or format sources (AVIF → WebP), in preference order. */
  sources?: { srcSet: string; type?: string; media?: string }[];
  srcSet?: string;
  sizes?: string;
  /** Dominant colour; the media table has no field yet, so the default is basalt-900 (§9.7). */
  placeholder?: string;
}

export type Ratio = "21/9" | "16/9" | "3/2" | "4/5" | "9/16";

/**
 * Aperture: a sharp window onto real media; the frame stays still, the view moves (§7, §9).
 * Without media it shows the survey-drawing plate with a slot label (`plate="survey"`), or a
 * project's title on basalt-900 (`plate="type"`) — never a stock or generated image.
 */
export function Aperture({
  ratio = "3/2",
  media,
  plate = "survey",
  slotLabel,
  typeTitle,
  reveal = true,
  priority,
  transitionName,
  className,
  as: Tag = "figure",
  caption,
}: {
  /** null: the ratio comes from the context's CSS (e.g. ProjectFeature is 4:5 → 21:9). */
  ratio?: Ratio | null;
  media?: MediaAsset | null;
  plate?: "survey" | "horizon" | "type";
  slotLabel?: string;
  typeTitle?: string;
  reveal?: boolean;
  /** The page's one LCP image (fetchpriority="high"); everything else is lazy. */
  priority?: boolean;
  /** view-transition-name for the Work → project morph. */
  transitionName?: string;
  className?: string;
  as?: "figure" | "div";
  caption?: ReactNode;
}) {
  const style: Style = ratio ? { "--ratio": ratio.replace("/", " / ") } : {};
  if (media?.placeholder) style["--ph"] = media.placeholder;
  if (transitionName) style.viewTransitionName = transitionName;
  const view = media ? (
    <div className="v-aperture__view">
      <picture>
        {media.sources?.map((s) => (
          <source
            key={`${s.type}-${s.media}-${s.srcSet}`}
            srcSet={s.srcSet}
            type={s.type}
            media={s.media}
            sizes={media.sizes}
          />
        ))}
        <img
          className="v-aperture__img"
          src={media.src}
          srcSet={media.srcSet}
          sizes={media.sizes}
          width={media.width}
          height={media.height}
          alt={media.alt}
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "sync" : "async"}
          fetchPriority={priority ? "high" : undefined}
          style={{ "--fx": media.focalX ?? 0.5, "--fy": media.focalY ?? 0.5 } as Style}
        />
      </picture>
    </div>
  ) : plate === "type" ? (
    <div className="v-aperture__view v-plate v-plate--type" aria-hidden="true">
      <span>{typeTitle}</span>
    </div>
  ) : (
    <div
      className={cx("v-aperture__view", "v-plate", plate === "horizon" && "v-plate--horizon")}
      aria-hidden="true"
    />
  );
  return (
    <Tag
      className={cx("v-aperture", className)}
      style={style}
      data-reveal={reveal ? "" : undefined}
    >
      {view}
      {!media && plate !== "type" && slotLabel ? (
        <span className="v-aperture__slot" aria-hidden="true">
          <span>{slotLabel}</span>
          {ratio ? <span>{ratio.replace("/", ":")}</span> : null}
        </span>
      ) : null}
      {caption && Tag === "figure" ? <figcaption className="v-sr">{caption}</figcaption> : null}
    </Tag>
  );
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "s" | "m" | "l";

function buttonClass(variant: ButtonVariant, size: ButtonSize, block?: boolean, extra?: string) {
  return cx(
    "v-btn",
    `v-btn--${variant}`,
    size !== "m" && `v-btn--${size}`,
    block && "v-btn--block",
    extra,
  );
}

/** A link styled as a button (navigation). One primary per screen. */
export function ButtonLink({
  to,
  children,
  variant = "primary",
  size = "m",
  arrow = true,
  block,
  className,
  current,
}: {
  to: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: boolean;
  block?: boolean;
  className?: string;
  /** The header CTA on /contact: keeps its place, loses its arrow, marks the page (§5.2). */
  current?: boolean;
}) {
  return (
    <SiteLink
      to={to}
      className={buttonClass(variant, size, block, className)}
      aria-current={current ? "page" : undefined}
    >
      {children}
      {arrow && !current ? <ArrowRight /> : null}
    </SiteLink>
  );
}

/** Arrow link: secondary navigation inside a section ("See the work →"). */
export function ArrowLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SiteLink to={to} className={cx("v-arrowlink", className)}>
      <span>{children}</span>
      <ArrowRight />
    </SiteLink>
  );
}

/** Back link: the parent section as a label above the title, with a left arrow. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <SiteLink to={to} className="v-arrowlink v-arrowlink--back v-label">
      <ArrowLeft />
      <span>{children}</span>
    </SiteLink>
  );
}

/** External link: north-east arrow, noopener, and the new-tab announcement. */
export function ExternalLink({
  href,
  children,
  className,
  arrow = true,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  arrow?: boolean;
}) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      className={cx(arrow && "v-arrowlink v-arrowlink--external", className)}
    >
      <span>{children}</span>
      {arrow ? <ArrowUpRight /> : null}
      <span className="v-sr"> (opens in a new tab)</span>
    </a>
  );
}

/** Section header: label, title, optional lead and arrow link (§7.1). */
export function SectionHeader({
  label,
  title,
  titleAs = "h2",
  titleClass = "v-display-l",
  lead,
  link,
  id,
  margin = true,
}: {
  label: ReactNode;
  title: readonly ReactNode[];
  titleAs?: "h1" | "h2" | "h3";
  titleClass?: string;
  lead?: ReactNode;
  link?: { to: string; label: string };
  id?: string;
  /** The editorial margin-label layout on desktop (label in columns 1–3). */
  margin?: boolean;
}) {
  const body = (
    <>
      <Lines as={titleAs} className={titleClass} lines={title} id={id} />
      {lead ? (
        <p className="v-lead v-fade" style={{ "--i": 1 } as Style}>
          {lead}
        </p>
      ) : null}
      {link ? (
        <p className="v-fade" style={{ "--i": 2 } as Style}>
          <ArrowLink to={link.to}>{link.label}</ArrowLink>
        </p>
      ) : null}
    </>
  );
  return margin ? (
    <div className="v-sechead" data-reveal="">
      <Label fade>{label}</Label>
      <div className="v-sechead__body">{body}</div>
    </div>
  ) : (
    <div className="v-stack" style={{ gap: "var(--space-5)" }} data-reveal="">
      <Label fade>{label}</Label>
      {body}
    </div>
  );
}

/**
 * The closing invitation (§7.9): label, one sentence written for the page (a slot until
 * written), the `l` primary action and the email as a text link. Differs per page.
 */
export function Invitation({
  label = "Next — Start a project",
  line,
  action = { to: "/contact", label: "Start a project" },
  email,
  className,
}: {
  label?: string;
  line: ReactNode;
  action?: { to: string; label: string } | null;
  email?: string | null;
  className?: string;
}) {
  return (
    <section className={cx("v-invite v-container", className)} data-reveal="" aria-label={label}>
      <Label fade>{label}</Label>
      <Lines as="h2" className="v-display-l v-invite__line" lines={[line]} />
      <div className="v-invite__actions v-fade" style={{ "--i": 1 } as Style}>
        {action ? (
          <ButtonLink to={action.to} size="l">
            {action.label}
          </ButtonLink>
        ) : null}
        {email ? (
          <a className="v-link v-body-s" href={`mailto:${email}`}>
            {email}
          </a>
        ) : null}
      </div>
    </section>
  );
}

/** One honest sentence and at most one action (§7.15). */
export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("v-empty", className)}>{children}</div>;
}

export type StatusKind = "ok" | "warn" | "down" | "info" | "muted";

/** StatusIndicator: an 8 px square in the status colour plus a DM Mono label. */
export function StatusIndicator({
  kind,
  children,
  struck,
}: {
  kind: StatusKind;
  children: ReactNode;
  struck?: boolean;
}) {
  return (
    <span className={cx("v-status", `v-status--${kind}`, struck && "v-status--struck")}>
      {children}
    </span>
  );
}

/** QuoteBlock: a real person's own words only (testimonials stay off — D13). */
export function QuoteBlock({ quote, attribution }: { quote: ReactNode; attribution?: string }) {
  return (
    <figure className="v-quote">
      <blockquote>{quote}</blockquote>
      {attribution ? <figcaption className="v-label">{attribution}</figcaption> : null}
    </figure>
  );
}
