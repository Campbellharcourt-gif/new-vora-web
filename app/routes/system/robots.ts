import { load } from "~/.server/guards";
import type { Route } from "./+types/robots";

/** Production allows crawling of public pages only; every other environment disallows all. */
export async function loader({ context }: Route.LoaderArgs) {
  const { server } = load(context);
  const body =
    server.config.appEnv === "production"
      ? [
          "User-agent: *",
          "Disallow: /admin",
          "Disallow: /account",
          "Disallow: /client",
          "Disallow: /member",
          "Disallow: /api",
          "Disallow: /preview",
          "Disallow: /login",
          "Disallow: /logout",
          "Disallow: /setup",
          "Disallow: /invite",
          "Disallow: /reset-password",
          "Disallow: /forgot-password",
          "",
          `Sitemap: ${server.config.origin}/sitemap.xml`,
          "",
        ].join("\n")
      : "User-agent: *\nDisallow: /\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
