import type { ContentBlock, Inline } from "@shared/content/blocks";
import type { ReactNode } from "react";

/**
 * Renders structured CMS content. Text is rendered as React text nodes (escaped); links are
 * already validated to https/mailto/site paths by the block schema. No raw HTML exists anywhere.
 * Media blocks render once the media delivery route ships (Phase 5); until then they are skipped
 * rather than rendered as broken images.
 */
function renderInline(inline: Inline, key: number): ReactNode {
  let node: ReactNode = inline.text;
  for (const mark of inline.marks ?? []) {
    if (mark.type === "bold") node = <strong>{node}</strong>;
    else if (mark.type === "italic") node = <em>{node}</em>;
    else if (mark.type === "link") {
      const external = /^https?:\/\//.test(mark.href);
      node = (
        <a href={mark.href} {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}>
          {node}
        </a>
      );
    }
  }
  return <span key={key}>{node}</span>;
}

const inlines = (content: readonly Inline[]) => content.map(renderInline);

export function Blocks({ blocks }: { blocks: readonly ContentBlock[] }) {
  return (
    <div className="stack" style={{ ["--stack-gap" as string]: "var(--space-4)" }}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case "paragraph":
            return <p key={key}>{inlines(block.content)}</p>;
          case "heading": {
            const Tag = `h${block.level}` as "h2" | "h3" | "h4";
            return <Tag key={key}>{inlines(block.content)}</Tag>;
          }
          case "list": {
            const Tag = block.style === "number" ? "ol" : "ul";
            return (
              <Tag key={key}>
                {block.items.map((item, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered content
                  <li key={i}>{inlines(item)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={key}>
                <p>{inlines(block.content)}</p>
                {block.attribution ? (
                  <footer className="muted">— {block.attribution}</footer>
                ) : null}
              </blockquote>
            );
          case "divider":
            return <hr key={key} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
