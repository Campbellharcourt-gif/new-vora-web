import { blocksSchema, type ContentBlock } from "@shared/content/blocks";
import { load } from "~/.server/guards";
import { getPublishedPage } from "~/.server/services/published-content";
import { getSetting } from "~/.server/services/settings";
import { Blocks, blockText as plainText } from "~/components/content/Blocks";
import {
  EmptyState,
  Invitation,
  Label,
  Lines,
  QuoteBlock,
  SiteLink,
  Slot,
  SurveyLine,
  Times,
} from "~/components/vora/primitives";
import { ProcessLine } from "~/components/vora/services";
import type { Route } from "./+types/our-story";

export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const [page, emails] = await Promise.all([
    getPublishedPage(server, "our-story"),
    getSetting(server, "contact.emails"),
  ]);
  if (!page) return { page: null, projectsEmail: emails.projects };
  const body = blocksSchema.safeParse(page.body);
  return {
    page: {
      title: String(page.title ?? "Our Story"),
      intro: typeof page.intro === "string" ? page.intro : null,
      body: body.success ? body.data : [],
    },
    projectsEmail: emails.projects,
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Our Story — VORA" }];
}

interface Chapter {
  title: string;
  blocks: ContentBlock[];
}

/** Each h2 opens a chapter (a shot); anything before the first heading is the preface. */
function chapters(blocks: readonly ContentBlock[]): { preface: ContentBlock[]; list: Chapter[] } {
  const preface: ContentBlock[] = [];
  const list: Chapter[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && block.level === 2) {
      list.push({ title: plainText([block]), blocks: [] });
    } else if (list.length > 0) {
      list[list.length - 1]?.blocks.push(block);
    } else {
      preface.push(block);
    }
  }
  return { preface, list };
}

/** "Design × Technology × Identity." becomes a typographic triptych (§16.6). */
function triptychWords(text: string): string[] | null {
  const words = text
    .replace(/\.$/, "")
    .split("×")
    .map((w) => w.trim());
  return words.length === 3 && words.every((w) => w && w.length <= 24) ? words : null;
}

function listItems(block: ContentBlock): string[] | null {
  if (block.type !== "list") return null;
  return block.items.map((item) =>
    item
      .map((i) => i.text)
      .join("")
      .trim(),
  );
}

function ChapterShot({ chapter, index }: { chapter: Chapter; index: number }) {
  const [first, ...rest] = chapter.blocks;
  const statement = first?.type === "paragraph" ? plainText([first]) : null;
  const words = statement ? triptychWords(statement) : null;
  const remaining = statement ? rest : chapter.blocks;
  const label = `${String(index).padStart(2, "0")} — ${chapter.title}`;
  const headingId = `chapter-${index}`;
  return (
    <section className="v-container v-station" aria-labelledby={headingId}>
      <div className="v-stack" style={{ gap: "var(--space-7)" }} data-reveal="">
        <Label as="h2" fade id={headingId}>
          {label}
        </Label>
        {words ? (
          <ul className="v-triptych" aria-label={statement ?? undefined}>
            {words.map((word, i) => (
              <li key={word}>
                <span className="v-triptych__word">
                  {word}
                  {i < 2 ? (
                    <>
                      {" "}
                      <Times />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : statement ? (
          <Lines as="p" className="v-display-l" lines={[statement]} style={{ maxWidth: "20ch" }} />
        ) : null}
        {remaining.map((block, i) => {
          const items = listItems(block);
          if (items && items.length >= 3 && items.length <= 6) {
            // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered content
            return <ProcessLine key={i} steps={items} label={chapter.title} />;
          }
          if (block.type === "quote") {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered content
              <div key={i} data-theme="mist" className="v-quote-moment">
                <QuoteBlock quote={plainText([block])} attribution={block.attribution} />
              </div>
            );
          }
          // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered content
          return <Blocks key={i} blocks={[block]} />;
        })}
      </div>
    </section>
  );
}

/**
 * Our Story (§16.6): a chaptered long-read built from the CMS page. Each heading is a shot —
 * a label, the chapter's one-line statement at display size, supporting text at the measure;
 * the idea line becomes a triptych and "How we work" the Process line. Nothing appears until
 * the page is published.
 */
export default function OurStory({ loaderData }: Route.ComponentProps) {
  const { page, projectsEmail } = loaderData;
  const parsed = page ? chapters(page.body) : null;
  return (
    <article>
      <header className="v-opening v-container" data-reveal="">
        <Label fade>Our Story</Label>
        <Lines as="h1" className="v-display-l" lines={[page?.title ?? "Our Story"]} />
        {page?.intro ? <p className="v-lead v-fade">{page.intro}</p> : null}
      </header>

      {page && parsed ? (
        <>
          {parsed.preface.length > 0 ? (
            <div className="v-container">
              <Blocks blocks={parsed.preface} />
            </div>
          ) : null}
          {parsed.list.map((chapter, i) => (
            <ChapterShot key={chapter.title} chapter={chapter} index={i + 1} />
          ))}
          <div className="v-container">
            <SurveyLine />
          </div>
          <Invitation line={<Slot>Our Story invitation — copy slot</Slot>} email={projectsEmail} />
        </>
      ) : (
        <div className="v-container" style={{ paddingBottom: "var(--section-m)" }}>
          <EmptyState>
            <p className="v-body">This story is being written.</p>
            <p className="v-body-s">
              <SiteLink className="v-link" to="/contact">
                Get in touch
              </SiteLink>{" "}
              in the meantime.
            </p>
          </EmptyState>
        </div>
      )}
    </article>
  );
}
