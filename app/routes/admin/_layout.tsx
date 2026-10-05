import { Outlet } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { unreadNotificationCount } from "~/.server/services/notifications";
import { WorkspaceShell } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/_layout";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const unread = await unreadNotificationCount(load(context).server, actor);
  const contentArea =
    has("pages.view") ||
    has("projects.view") ||
    has("services.view") ||
    has("partners.view") ||
    has("careers.view");
  return {
    user: { name: actor.name, email: actor.email },
    unread,
    nav: [
      { to: "/admin", label: "Dashboard", end: true },
      ...(has("enquiries.view") ? [{ to: "/admin/enquiries", label: "Enquiries" }] : []),
      ...(has("clients.view") ? [{ to: "/admin/clients", label: "Clients" }] : []),
      ...(has("engagements.view") ? [{ to: "/admin/engagements", label: "Client projects" }] : []),
      ...(contentArea ? [{ to: "/admin/content", label: "Content" }] : []),
      ...(has("projects.view") ? [{ to: "/admin/projects", label: "Case studies" }] : []),
      ...(has("services.view") ? [{ to: "/admin/services", label: "Services" }] : []),
      ...(has("partners.view") ? [{ to: "/admin/partners", label: "Partners" }] : []),
      ...(has("careers.view") ? [{ to: "/admin/careers", label: "Careers" }] : []),
      ...(has("ai.use") || has("ai.manage") || has("ai.usage.view")
        ? [{ to: "/admin/ai", label: "VORA AI" }]
        : []),
      ...(has("users.view") ? [{ to: "/admin/users", label: "Users" }] : []),
      ...(has("privacy.manage") ? [{ to: "/admin/privacy", label: "Privacy requests" }] : []),
      ...(has("security.view") ? [{ to: "/admin/security", label: "Security" }] : []),
      ...(has("audit.view") ? [{ to: "/admin/audit", label: "Audit log" }] : []),
      ...(has("settings.view") ? [{ to: "/admin/settings", label: "Settings" }] : []),
      ...(has("system.status") ? [{ to: "/admin/system", label: "System" }] : []),
    ],
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Admin — VORA" }, { name: "robots", content: "noindex" }];
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <WorkspaceShell
      area="Admin"
      user={loaderData.user}
      nav={loaderData.nav}
      switchTo={[
        {
          to: "/account/notifications",
          label: loaderData.unread > 0 ? `Notifications (${loaderData.unread})` : "Notifications",
        },
        { to: "/account/security", label: "Your account" },
      ]}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
