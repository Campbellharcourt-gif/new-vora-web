import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { AppError } from "../lib/errors";
import { isFlagEnabled } from "../services/flags";
import {
  getPublishedPage,
  listOpenRoles,
  listPublishedPartners,
  listPublishedProjects,
  listPublishedServices,
} from "../services/published-content";
import { getSetting } from "../services/settings";
import { getAiProvider, runAi } from "./service";
import { AI_USER_MESSAGES, type AiMessage } from "./types";

/**
 * The public "Ask VORA" assistant (design system §11.5, decision D8). It is switched off by
 * default: it answers only when the `ai.public_assistant` flag, the `ai.config.publicEnabled`
 * setting AND a server-side provider key are all present. The key never reaches the browser;
 * every request goes through `runAi` (limits, budgets, circuit breaker, usage ledger).
 *
 * Answers are grounded in published content only (never drafts). The model may name sources,
 * but only paths from the published allowlist below survive — nothing else becomes a link, and
 * nothing is ever fabricated on the server's side: a failure is reported as a failure.
 */

export interface AssistantAvailability {
  available: boolean;
  maxInputChars: number;
}

export async function publicAssistantAvailability(
  ctx: ServerContext,
  actor: Actor | null,
): Promise<AssistantAvailability> {
  const config = await getSetting(ctx, "ai.config");
  if (!config.publicEnabled) return { available: false, maxInputChars: config.maxInputChars };
  const flag = await isFlagEnabled(ctx, "ai.public_assistant", actor);
  const provider = flag ? getAiProvider(ctx, config) : null;
  return { available: Boolean(flag && provider), maxInputChars: config.maxInputChars };
}

export interface AssistantSource {
  href: string;
  label: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const MAX_CONTEXT_CHARS = 12_000;

/** Published pages the answer may cite, with the facts each contributes to the context. */
async function groundingContext(ctx: ServerContext) {
  const [services, projects, partners, story, roles, emails] = await Promise.all([
    listPublishedServices(ctx),
    listPublishedProjects(ctx),
    listPublishedPartners(ctx),
    getPublishedPage(ctx, "our-story"),
    listOpenRoles(ctx),
    getSetting(ctx, "contact.emails"),
  ]);
  const pages: { href: string; label: string; facts: string }[] = [
    {
      href: "/contact",
      label: "Contact",
      facts: `Start a project with the enquiry form. Projects: ${emails.projects}. General: ${emails.general}.`,
    },
  ];
  if (services.length > 0) {
    pages.push({
      href: "/services",
      label: "Services",
      facts: services
        .map((s) => {
          const model = String(s.deliveryModel ?? "vora");
          const who =
            model === "partner"
              ? "creative by Solara Studios, digital by VORA"
              : model === "joint"
                ? "VORA with Solara Studios"
                : "delivered by VORA";
          return `${String(s.name ?? "")}: ${str(s.summary) ?? ""} (${who})`;
        })
        .join("\n"),
    });
    for (const s of services) {
      const slug = str(s.slug);
      if (slug) pages.push({ href: `/services/${slug}`, label: String(s.name ?? slug), facts: "" });
    }
  }
  if (projects.length > 0) {
    pages.push({
      href: "/work",
      label: "Work",
      facts: projects
        .map((p) => `${p.title}${p.category ? ` (${p.category})` : ""}: ${p.summary ?? ""}`)
        .join("\n"),
    });
    for (const p of projects) pages.push({ href: `/work/${p.slug}`, label: p.title, facts: "" });
  }
  if (partners.length > 0) {
    pages.push({
      href: "/partners",
      label: "Partners",
      facts: partners
        .map((p) =>
          [str(p.name), str(p.relationship), str(p.description), str(p.statement)]
            .filter(Boolean)
            .join(" — "),
        )
        .join("\n"),
    });
  }
  if (story) {
    const body = Array.isArray(story.body)
      ? (story.body as { content?: { text?: string }[] }[])
      : [];
    const text = body
      .map((b) => (b.content ?? []).map((i) => i.text ?? "").join(""))
      .filter(Boolean)
      .join("\n");
    pages.push({ href: "/our-story", label: "Our Story", facts: text });
  }
  if (roles.length > 0) {
    pages.push({
      href: "/careers",
      label: "Careers",
      facts: roles.map((r) => String(r.title ?? "")).join(", "),
    });
  }
  return pages;
}

function systemPrompt(pages: { href: string; label: string; facts: string }[]): string {
  let context = "";
  for (const page of pages) {
    const block = `PAGE ${page.href} (${page.label})\n${page.facts}\n\n`;
    if (context.length + block.length > MAX_CONTEXT_CHARS) break;
    context += block;
  }
  return [
    "You are VORA AI on the website of VORA, a digital studio.",
    "Answer ONLY from the published pages below. If the answer is not in them, say you don't know and suggest contacting the team through the contact page.",
    "Never invent clients, projects, prices, timelines, statistics or quotes. Be brief and plain.",
    "After the answer, on its own final line, write SOURCES: followed by the page paths you used, separated by commas (for example SOURCES: /services, /partners). Use only paths listed below.",
    "",
    context.trim(),
  ].join("\n");
}

/** Splits the trailing SOURCES line off and keeps only allow-listed published paths. */
export function extractSources(
  raw: string,
  allowed: ReadonlyMap<string, string>,
): { text: string; sources: AssistantSource[] } {
  const lines = raw.trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  const match = /^\s*SOURCES:\s*(.*)$/i.exec(last);
  const text = (match ? lines.slice(0, -1) : lines).join("\n").trim();
  const sources: AssistantSource[] = [];
  if (match) {
    for (const part of (match[1] ?? "").split(",")) {
      const href = part.trim().replace(/[.)\]]+$/, "");
      const label = allowed.get(href);
      if (label && !sources.some((s) => s.href === href)) sources.push({ href, label });
    }
  }
  return { text, sources: sources.slice(0, 4) };
}

export async function askVora(
  ctx: ServerContext,
  actor: Actor | null,
  messages: AiMessage[],
): Promise<{ text: string; sources: AssistantSource[] }> {
  const pages = await groundingContext(ctx);
  const result = await runAi(ctx, {
    channel: "public",
    actor,
    system: systemPrompt(pages),
    messages,
  });
  const allowed = new Map(pages.map((p) => [p.href, p.label]));
  const answer = extractSources(result.text, allowed);
  // An empty answer is a failure, reported as one — never replaced with made-up text.
  if (!answer.text) {
    throw new AppError("service_unavailable", { message: AI_USER_MESSAGES.malformed });
  }
  return answer;
}
