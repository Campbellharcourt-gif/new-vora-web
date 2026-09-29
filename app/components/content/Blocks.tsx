import type { ContentBlock, Inline } from "@shared/content/blocks";
import type { ReactNode } from "react";
import { QuoteBlock, SurveyLine } from "~/components/vora/primitives";

/**
 * Renders structured CMS content in the VORA reading layout (design system §7.3). Text is
 * rendered as React text nodes (escaped); links are already validated to https/mailto/site
 * paths by the block schema. No raw HTML exists anywhere.
 *
 * Media blocks (image, gallery, video) render once the media delivery route ships (Phase 5);
 * embeds need a click-to-load frame and a CSP frame-src decision. Until then they are skipped
 * rather than rendered as broken images or third-party requests.
 */
function renderInline(inline: Inline, key: number): ReactNode {
  let node: ReactNode = inline.text;
  for (const mark of inline.marks ?? []) {
    if (mark.type === "bold") node = <strong>{node}</strong>;
    else if (mark.type === "italic") node = <em>{node}</em>;
    else if (mark.type === "link") {
      const external = /^https?:\/\//.test(mark.href);
      node = external ? (
        <a className="v-link" href={mark.href} rel="noopener noreferrer" target="_blank">
          {node}
          <span className="v-sr"> (opens in a new tab)</span>
        </a>
      ) : (
        <a className="v-link" href={mark.href}>
          {node}
        </a>
      );
    }
  }
  return <span key={key}>{node}</span>;
}

const inlines = (content: readonly Inline[]) => content.map(renderInline);

/**
 * The plain text of blocks. A client-side copy of `plainText` in shared/content/blocks.ts, so
 * the page bundles never pull in the schema module (and zod) just for this.
 */
export function blockText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if ("content" in block) parts.push(block.content.map((i) => i.text).join(""));
    if (block.type === "list")
      parts.push(block.items.map((item) => item.map((i) => i.text).join("")).join(" "));
  }
  return parts.join("\n").trim();
}

/** A stable, readable anchor for a heading (used by the legal contents list). */
export function headingAnchor(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

/** The h2 outline of a body, with the same anchors the renderer gives the headings. */
export function outline(blocks: readonly ContentBlock[]): { id: string; text: string }[] {
  const seen = new Map<string, number>();
  const items: { id: string; text: string }[] = [];
  for (const block of blocks) {
    if (block.type !== "heading" || block.level !== 2) continue;
    const text = blockText([block]);
    items.push({ id: uniqueAnchor(seen, headingAnchor(text)), text });
  }
  return items;
}

function uniqueAnchor(seen: Map<string, number>, base: string): string {
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

const SHORT_LIST = 6;

export function Blocks({
  blocks,
  className = "v-prose",
}: {
  blocks: readonly ContentBlock[];
  className?: string;
}) {
  const seen = new Map<string, number>();
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case "paragraph":
            return <p key={key}>{inlines(block.content)}</p>;
          case "heading": {
            const Tag = `h${block.level}` as "h2" | "h3" | "h4";
            const id =
              block.level === 2 ? uniqueAnchor(seen, headingAnchor(blockText([block]))) : undefined;
            return (
              <Tag key={key} id={id}>
                {inlines(block.content)}
              </Tag>
            );
          }
          case "list": {
            const Tag = block.style === "number" ? "ol" : "ul";
            // Up to six short items read as hairline rows (e.g. the six process steps).
            const short =
              block.items.length <= SHORT_LIST &&
              block.items.every((item) => item.map((i) => i.text).join("").length <= 60);
            return (
              <Tag key={key} className={short ? "v-rows" : undefined}>
                {block.items.map((item, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered content
                  <li key={i}>{inlines(item)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <QuoteBlock
                key={key}
                quote={inlines(block.content)}
                attribution={block.attribution}
              />
            );
          case "divider":
            return (
              <div key={key} data-reveal="">
                <SurveyLine variant="draw" />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
