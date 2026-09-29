import { load } from "~/.server/guards";
import {
  listOpenRoles,
  listPublishedProjects,
  listPublishedServices,
} from "~/.server/services/published-content";
import type { Route } from "./+types/sitemap";

const STATIC_PATHS = [
  "/",
  "/services",
  "/work",
  "/our-story",
  "/partners",
  "/careers",
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Sitemap built only from public routes and PUBLISHED content. */
export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const origin = server.config.origin;
  const [projects, services, roles] = await Promise.all([
    listPublishedProjects(server),
    listPublishedServices(server),
    listOpenRoles(server),
  ]);
  const paths = [
    ...STATIC_PATHS,
    ...services.map((s) => `/services/${String(s.slug)}`),
    ...projects.map((p) => `/work/${p.slug}`),
    ...roles.map((r) => `/careers/${String(r.slug)}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((p) => `  <url><loc>${xmlEscape(`${origin}${p}`)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
