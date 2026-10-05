import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

/**
 * Route map (see docs/01-ARCHITECTURE.md §3). Public pages share the site layout; auth pages the
 * minimal auth layout; account/admin/client/member are guarded areas using the workspace theme.
 * Legacy Mark4 URLs are redirected in the kernel before React Router runs.
 */
export default [
  layout("routes/public/_layout.tsx", [
    index("routes/public/home.tsx"),
    route("services", "routes/public/services.tsx"),
    route("services/:slug", "routes/public/service.tsx"),
    route("work", "routes/public/work.tsx"),
    route("work/:slug", "routes/public/project.tsx"),
    route("our-story", "routes/public/our-story.tsx"),
    route("partners", "routes/public/partners.tsx"),
    route("careers", "routes/public/careers.tsx"),
    route("careers/:slug", "routes/public/career.tsx"),
    route("contact", "routes/public/contact.tsx"),
    route("terms", "routes/public/legal.tsx", { id: "legal-terms" }),
    route("privacy", "routes/public/legal.tsx", { id: "legal-privacy" }),
    route("cookies", "routes/public/legal.tsx", { id: "legal-cookies" }),
    route("status", "routes/public/status.tsx"),
  ]),
  layout("routes/auth/_layout.tsx", [
    route("login", "routes/auth/login.tsx"),
    route("login/verify", "routes/auth/login-verify.tsx"),
    route("login/recovery", "routes/auth/login-recovery.tsx"),
    route("forgot-password", "routes/auth/forgot-password.tsx"),
    route("reset-password/:token", "routes/auth/reset-password.tsx"),
    route("invite/:token", "routes/auth/invite.tsx"),
    route("setup", "routes/auth/setup.tsx"),
    route("register", "routes/auth/register.tsx"),
    route("verify-email/:token", "routes/auth/verify-email.tsx"),
  ]),
  route("logout", "routes/auth/logout.tsx"),
  route("account", "routes/account/_layout.tsx", [
    index("routes/account/index.tsx"),
    route("security", "routes/account/security.tsx"),
  ]),
  route("admin", "routes/admin/_layout.tsx", [
    index("routes/admin/dashboard.tsx"),
    route("enquiries", "routes/admin/enquiries.tsx"),
    route("enquiries/:id", "routes/admin/enquiry.tsx"),
    route("clients", "routes/admin/clients.tsx"),
    route("clients/:id", "routes/admin/client.tsx"),
    route("engagements", "routes/admin/engagements.tsx"),
    route("engagements/:id", "routes/admin/engagement.tsx"),
    route("projects", "routes/admin/content-list.tsx", { id: "admin-projects" }),
    route("projects/:id", "routes/admin/content-item.tsx", { id: "admin-project" }),
    route("services", "routes/admin/content-list.tsx", { id: "admin-services" }),
    route("services/:id", "routes/admin/content-item.tsx", { id: "admin-service" }),
    route("partners", "routes/admin/content-list.tsx", { id: "admin-partners" }),
    route("partners/:id", "routes/admin/content-item.tsx", { id: "admin-partner" }),
    route("careers", "routes/admin/content-list.tsx", { id: "admin-careers" }),
    route("careers/:id", "routes/admin/content-item.tsx", { id: "admin-career" }),
    route("content", "routes/admin/content.tsx"),
    route("content/pages/:id", "routes/admin/content-item.tsx", { id: "admin-page" }),
    route("settings", "routes/admin/settings.tsx"),
    route("security", "routes/admin/security.tsx"),
    route("audit", "routes/admin/audit.tsx"),
    route("users", "routes/admin/users.tsx"),
    route("system", "routes/admin/system.tsx"),
  ]),
  route("client", "routes/client/_layout.tsx", [
    index("routes/client/index.tsx"),
    route("projects/:id", "routes/client/project.tsx"),
  ]),
  route("member", "routes/member/_layout.tsx", [index("routes/member/index.tsx")]),
  route("sitemap.xml", "routes/system/sitemap.ts"),
  route("robots.txt", "routes/system/robots.ts"),
  route("*", "routes/system/not-found.tsx"),
] satisfies RouteConfig;
