import type { ContentBlock } from "@shared/content/blocks";
import { blocksToText, TextFormatError, textToBlocks } from "@shared/content/text-format";
import { describe, expect, it } from "vitest";

describe("content text format", () => {
  it("parses headings, paragraphs, lists, quotes and dividers", () => {
    const blocks = textToBlocks(
      [
        "## How we work",
        "We start with",
        "a conversation.",
        "",
        "- Discover",
        "- Define",
        "",
        "1. First",
        "2. Second",
        "",
        "> Great ideas deserve better.",
        "> — Strive",
        "",
        "---",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "heading", level: 2, content: [{ text: "How we work" }] },
      { type: "paragraph", content: [{ text: "We start with a conversation." }] },
      { type: "list", style: "bullet", items: [[{ text: "Discover" }], [{ text: "Define" }]] },
      { type: "list", style: "number", items: [[{ text: "First" }], [{ text: "Second" }]] },
      {
        type: "quote",
        content: [{ text: "Great ideas deserve better." }],
        attribution: "Strive",
      },
      { type: "divider" },
    ]);
  });

  it("parses bold, italic and links, including nesting", () => {
    expect(textToBlocks("A **bold** and *italic* [site](https://vora.example) end.")).toEqual([
      {
        type: "paragraph",
        content: [
          { text: "A " },
          { text: "bold", marks: [{ type: "bold" }] },
          { text: " and " },
          { text: "italic", marks: [{ type: "italic" }] },
          { text: " " },
          { text: "site", marks: [{ type: "link", href: "https://vora.example" }] },
          { text: " end." },
        ],
      },
    ]);
    expect(textToBlocks("[**Contact**](/contact)")[0]).toEqual({
      type: "paragraph",
      content: [{ text: "Contact", marks: [{ type: "link", href: "/contact" }, { type: "bold" }] }],
    });
  });

  it("round-trips blocks exactly, including media blocks and literal markers", () => {
    const blocks: ContentBlock[] = [
      { type: "heading", level: 3, content: [{ text: "Notes" }] },
      { type: "paragraph", content: [{ text: "- not a list, and *not* italic [x]" }] },
      { type: "paragraph", content: [{ text: "back\\slash" }] },
      {
        type: "paragraph",
        content: [
          { text: "Read " },
          {
            text: "this",
            marks: [{ type: "link", href: "https://vora.example/a" }, { type: "bold" }],
          },
        ],
      },
      {
        type: "image",
        mediaId: "med_01J00000000000000000000000",
        alt: "Studio",
        layout: "wide",
      },
      { type: "quote", content: [{ text: "Only a quote" }] },
    ];
    expect(textToBlocks(blocksToText(blocks))).toEqual(blocks);
  });

  it("refuses unsafe links and broken media blocks with a readable message", () => {
    expect(() => textToBlocks("[x](javascript:alert(1))")).toThrow(TextFormatError);
    expect(() => textToBlocks("[[block {nope]]")).toThrow(/media block/);
    expect(() => textToBlocks('[[block {"type":"image","mediaId":"not-a-media-id"}]]')).toThrow(
      TextFormatError,
    );
  });

  it("never yields HTML: angle brackets stay plain text", () => {
    expect(textToBlocks("<script>alert(1)</script>")).toEqual([
      { type: "paragraph", content: [{ text: "<script>alert(1)</script>" }] },
    ]);
  });
});
