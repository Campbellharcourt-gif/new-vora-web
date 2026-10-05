import { blocksSchema, type ContentBlock, type Inline, type Mark } from "./blocks";

/**
 * The admin editor's plain-text format for content blocks — readable, typeable, and lossless:
 *
 *   ## Heading            (### and #### for levels 3 and 4)
 *   Paragraph text. Lines next to each other join into one paragraph.
 *   - Bullet item         (or "1. Numbered item")
 *   > Quote               ("> — Name" on the last line is the attribution)
 *   ---                   (divider)
 *   **bold**, *italic*, [link text](https://…)    (a backslash keeps a character literal: \*)
 *   [[block {"type":"image",…}]]                  (media blocks, kept exactly as stored)
 *
 * Parsing never produces HTML: the result is validated against `blocksSchema`, the same schema
 * the renderer trusts, so the text format can't smuggle in anything the blocks can't hold.
 */

const MARK_ORDER: Mark["type"][] = ["link", "bold", "italic"];

function escapeText(text: string): string {
  return text.replace(/[\\*[\]]/g, (c) => `\\${c}`);
}

function inlineToText(inline: Inline): string {
  let out = escapeText(inline.text);
  const marks = [...(inline.marks ?? [])].sort(
    (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type),
  );
  for (const mark of marks) {
    if (mark.type === "italic") out = `*${out}*`;
    else if (mark.type === "bold") out = `**${out}**`;
    else out = `[${out}](${mark.href})`;
  }
  return out;
}

const inlinesToText = (inlines: readonly Inline[]) => inlines.map(inlineToText).join("");

/** A line that would otherwise read as a block marker keeps its meaning as text. */
function guardLine(text: string): string {
  return /^(#{2,4} |[-*] |\d+\. |> |---$|\[\[block )/.test(text) ? `\\${text}` : text;
}

export function blocksToText(blocks: readonly ContentBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
        out.push(guardLine(inlinesToText(block.content)));
        break;
      case "heading":
        out.push(`${"#".repeat(block.level)} ${inlinesToText(block.content)}`);
        break;
      case "list":
        out.push(
          block.items
            .map((item, i) =>
              block.style === "number"
                ? `${i + 1}. ${inlinesToText(item)}`
                : `- ${inlinesToText(item)}`,
            )
            .join("\n"),
        );
        break;
      case "quote": {
        const lines = [`> ${inlinesToText(block.content)}`];
        if (block.attribution) lines.push(`> — ${block.attribution}`);
        out.push(lines.join("\n"));
        break;
      }
      case "divider":
        out.push("---");
        break;
      default:
        out.push(`[[block ${JSON.stringify(block)}]]`);
    }
  }
  return out.join("\n\n");
}

// --- Parsing ------------------------------------------------------------------------------------

const PATTERNS: { type: Mark["type"]; re: RegExp }[] = [
  { type: "link", re: /\[((?:\\.|[^\]\\])+)\]\(([^)\s]+)\)/ },
  { type: "bold", re: /\*\*((?:\\.|[^*\\]|\*(?!\*))+?)\*\*/ },
  { type: "italic", re: /\*((?:\\.|[^*\\])+?)\*/ },
];

const unescapeText = (text: string) => text.replace(/\\(.)/g, "$1");

function parseInline(source: string, marks: Mark[] = []): Inline[] {
  const out: Inline[] = [];
  const push = (text: string, withMarks: Mark[]) => {
    if (!text) return;
    out.push(withMarks.length > 0 ? { text, marks: withMarks } : { text });
  };
  let rest = source;
  while (rest.length > 0) {
    let best: { type: Mark["type"]; match: RegExpExecArray } | null = null;
    for (const { type, re } of PATTERNS) {
      const match = re.exec(rest);
      // Skip escaped openers ("\*" or "\[").
      if (match && match.index > 0 && rest[match.index - 1] === "\\") continue;
      if (match && (!best || match.index < best.match.index)) best = { type, match };
    }
    if (!best) {
      push(unescapeText(rest), marks);
      break;
    }
    push(unescapeText(rest.slice(0, best.match.index)), marks);
    const inner = best.match[1] ?? "";
    const mark: Mark =
      best.type === "link" ? { type: "link", href: best.match[2] ?? "" } : { type: best.type };
    out.push(...parseInline(inner, [...marks, mark]));
    rest = rest.slice(best.match.index + best.match[0].length);
  }
  return out;
}

export class TextFormatError extends Error {}

export function textToBlocks(text: string): ContentBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: unknown[] = [];
  let i = 0;
  const take = (test: (line: string) => boolean): string[] => {
    const taken: string[] = [];
    while (i < lines.length && test(lines[i] as string)) taken.push(lines[i++] as string);
    return taken;
  };
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{2,4}) (.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: (heading[1] as string).length,
        content: parseInline((heading[2] as string).trim()),
      });
      i++;
      continue;
    }
    if (line.trim() === "---") {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }
    const raw = /^\[\[block (.*)\]\]$/.exec(line.trim());
    if (raw) {
      try {
        blocks.push(JSON.parse(raw[1] as string));
      } catch {
        throw new TextFormatError(`Line ${i + 1}: this media block isn't valid.`);
      }
      i++;
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items = take((l) => /^[-*] /.test(l)).map((l) => parseInline(l.slice(2).trim()));
      blocks.push({ type: "list", style: "bullet", items });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = take((l) => /^\d+\. /.test(l)).map((l) =>
        parseInline(l.replace(/^\d+\. /, "").trim()),
      );
      blocks.push({ type: "list", style: "number", items });
      continue;
    }
    if (/^> ?/.test(line)) {
      const quoted = take((l) => /^> ?/.test(l)).map((l) => l.replace(/^> ?/, ""));
      const last = quoted.at(-1) ?? "";
      const attribution = /^(?:—|--) (.+)$/.exec(last.trim());
      if (attribution && quoted.length > 1) quoted.pop();
      blocks.push({
        type: "quote",
        content: parseInline(quoted.join(" ").trim()),
        ...(attribution && quoted.length > 0 ? { attribution: attribution[1]?.trim() } : {}),
      });
      continue;
    }
    const paragraph = take(
      (l) =>
        l.trim() !== "" &&
        !/^(#{2,4} |[-*] |\d+\. |> ?)/.test(l) &&
        l.trim() !== "---" &&
        !/^\[\[block /.test(l.trim()),
    );
    // A leading backslash guards text that would otherwise read as a marker.
    const joined = paragraph.map((l) => l.trim()).join(" ");
    blocks.push({
      type: "paragraph",
      content: parseInline(joined.startsWith("\\") ? joined.slice(1) : joined),
    });
  }
  const parsed = blocksSchema.safeParse(blocks);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const blockNo = typeof issue?.path[0] === "number" ? issue.path[0] + 1 : null;
    throw new TextFormatError(
      `${blockNo ? `Block ${blockNo}: ` : ""}${issue?.message ?? "This content isn't valid."}`,
    );
  }
  return parsed.data;
}
