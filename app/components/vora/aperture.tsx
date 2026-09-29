import type { ReactNode } from "react";
import { cx, type Style } from "./primitives";

/**
 * Aperture has its own module so that only the pages that show media load it: Home, Work, the
 * case studies and the service pages, which load the project components anyway (the bundler puts
 * it in their chunk). Contact, legal, careers, status, sign-in and the portals never download it
 * (the JavaScript budget, design system §14).
 */

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
