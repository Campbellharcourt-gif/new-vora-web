import { type ContentBlock, heading, paragraph } from "@shared/content/blocks";

/**
 * Base data for every environment. REAL CONTENT ONLY: everything here comes from the live Mark4
 * site, the brief or facts you supplied, and all content is seeded as DRAFT — nothing becomes
 * public until someone with publish permission reviews and publishes it.
 */

export const SEED_SOCIAL_LINKS = [
  {
    platform: "x",
    label: "X",
    url: "https://x.com/vorawebsites",
    handle: "@vorawebsites",
    placements: ["footer", "contact"],
    sortOrder: 10,
  },
  {
    platform: "discord",
    label: "Discord",
    url: "https://discord.gg/hVtud6EQ5Z",
    handle: null,
    placements: ["footer", "contact"],
    sortOrder: 20,
  },
] as const;

export const SEED_PARTNERS = [
  {
    slug: "solara-studios",
    name: "Solara Studios",
    relationship: "Creative partner",
    description: "A creative studio focused on design and visual work.",
    statement: "Creative by Solara. Digital by VORA.",
  },
] as const;

export const SEED_SERVICES = [
  {
    slug: "websites",
    name: "Websites",
    summary: "Premium digital experiences, websites and digital platforms.",
    deliveryModel: "vora",
    partnerSlug: null,
    sortOrder: 10,
  },
  {
    slug: "branding",
    name: "Branding",
    summary: "Brand identity, visual systems and digital identity.",
    deliveryModel: "partner",
    partnerSlug: "solara-studios",
    sortOrder: 20,
  },
  {
    slug: "motion",
    name: "Motion",
    summary: "Motion design and animated digital experiences.",
    deliveryModel: "partner",
    partnerSlug: "solara-studios",
    sortOrder: 30,
  },
  {
    slug: "film",
    name: "Film",
    summary: "Creative film, video and visual production.",
    deliveryModel: "partner",
    partnerSlug: "solara-studios",
    sortOrder: 40,
  },
] as const;

const REVIEW_NOTE = paragraph(
  "[Draft imported from the previous VORA site — review and rewrite before publishing.]",
);

export const SEED_PAGES: {
  key: string;
  title: string;
  intro: string | null;
  body: ContentBlock[];
}[] = [
  {
    key: "our-story",
    title: "Our Story",
    intro: null,
    body: [
      REVIEW_NOTE,
      heading("The beginning"),
      paragraph("Why should great organisations settle for average websites?"),
      heading("The problem"),
      paragraph("Great ideas. Average presence."),
      heading("The idea"),
      paragraph("Design × Technology × Identity."),
      heading("How we work"),
      {
        type: "list",
        style: "number",
        items: ["Discover", "Define", "Design", "Develop", "Refine", "Launch"].map((t) => [
          { text: t },
        ]),
      },
      heading("What's next"),
      paragraph("VORA starts with websites."),
      paragraph("Founded by Strive."),
    ],
  },
  {
    key: "terms",
    title: "Terms",
    intro: null,
    body: [paragraph("[Draft — terms must be written and approved before publishing.]")],
  },
  {
    key: "privacy",
    title: "Privacy",
    intro: null,
    body: [paragraph("[Draft — privacy notice must be written and approved before publishing.]")],
  },
  {
    key: "cookies",
    title: "Cookies",
    intro: null,
    body: [paragraph("[Draft — cookie notice must be written and approved before publishing.]")],
  },
];

export const SEED_PROJECTS = [
  {
    slug: "sail-gaming",
    title: "SAIL Gaming",
    category: "Esports",
    clientName: "SAIL Gaming",
    externalUrl: "https://sailgaming.store/",
    summary:
      "An esports-focused digital experience built around roster presentation, organisation identity, founders, news and competitive gaming culture.",
    serviceSlugs: ["websites"],
    sortOrder: 10,
  },
  {
    slug: "eon-clothing",
    title: "EON Clothing",
    category: "Commerce",
    clientName: "EON Clothing",
    externalUrl: "https://eonclothing.store/",
    summary:
      "A premium digital storefront built for EON, combining fashion presentation, editorial visuals and a high-end streetwear identity.",
    serviceSlugs: ["websites"],
    sortOrder: 20,
  },
] as const;

export const SEED_JOB_ROLES = [
  { slug: "web-designer", title: "Web Designer", sortOrder: 10 },
  { slug: "ui-ux-designer", title: "UI/UX Designer", sortOrder: 20 },
  { slug: "motion-designer", title: "Motion Designer", sortOrder: 30 },
  { slug: "developer", title: "Developer", sortOrder: 40 },
] as const;
