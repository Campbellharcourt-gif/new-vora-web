import { z } from "zod";

/**
 * Structured rich content. The CMS never stores or renders raw HTML: every block is data that
 * React renders with escaping, which removes stored-XSS by construction.
 */

const safeHref = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value.startsWith("/") && !value.startsWith("//")) return true; // internal path
    if (value.startsWith("mailto:")) return /^mailto:[^\s@]+@[^\s@]+$/.test(value);
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Links must be https://, mailto: or a site path.");

export const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("link"), href: safeHref }),
]);

export const inlineSchema = z.object({
  text: z.string().max(10_000),
  marks: z.array(markSchema).max(3).optional(),
});

const inlines = z.array(inlineSchema).max(200);
const mediaRef = z.string().regex(/^med_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid media reference");

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), content: inlines }),
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    content: inlines,
  }),
  z.object({
    type: z.literal("list"),
    style: z.enum(["bullet", "number"]),
    items: z.array(inlines).max(100),
  }),
  z.object({
    type: z.literal("quote"),
    content: inlines,
    attribution: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("image"),
    mediaId: mediaRef,
    alt: z.string().max(300).optional(),
    caption: z.string().max(500).optional(),
    layout: z.enum(["inline", "wide", "full"]).optional(),
  }),
  z.object({
    type: z.literal("gallery"),
    items: z
      .array(
        z.object({
          mediaId: mediaRef,
          alt: z.string().max(300).optional(),
          caption: z.string().max(500).optional(),
        }),
      )
      .max(40),
  }),
  z.object({
    type: z.literal("video"),
    mediaId: mediaRef,
    posterMediaId: mediaRef.optional(),
    caption: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("embed"),
    provider: z.enum(["youtube", "vimeo"]),
    id: z.string().regex(/^[A-Za-z0-9_-]{4,32}$/),
    title: z.string().min(1).max(200),
  }),
  z.object({ type: z.literal("divider") }),
]);

export const blocksSchema = z.array(blockSchema).max(500);

export type Mark = z.infer<typeof markSchema>;
export type Inline = z.infer<typeof inlineSchema>;
export type ContentBlock = z.infer<typeof blockSchema>;

/** Convenience for seeds and tests: a paragraph of plain text. */
export function paragraph(text: string): ContentBlock {
  return { type: "paragraph", content: [{ text }] };
}

export function heading(text: string, level: 2 | 3 | 4 = 2): ContentBlock {
  return { type: "heading", level, content: [{ text }] };
}

/** Publishing requires alt text on every image (accessibility gate). */
export function missingAltText(blocks: readonly ContentBlock[]): number {
  let missing = 0;
  for (const block of blocks) {
    if (block.type === "image" && !block.alt?.trim()) missing++;
    if (block.type === "gallery") missing += block.items.filter((i) => !i.alt?.trim()).length;
  }
  return missing;
}

export function plainText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if ("content" in block) parts.push(block.content.map((i) => i.text).join(""));
    if (block.type === "list")
      parts.push(block.items.map((item) => item.map((i) => i.text).join("")).join(" "));
  }
  return parts.join("\n").trim();
}
