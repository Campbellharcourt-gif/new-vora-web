import { Outlet } from "react-router";
import { requirePermission } from "~/.server/guards";
import { WorkspaceShell } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/_layout";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  return {
    user: { name: actor.name, email: actor.email },
    nav: [
      { to: "/admin", label: "Dashboard", end: true },
      ...(has("enquiries.view") ? [{ to: "/admin/enquiries", label: "Enquiries" }] : []),
      ...(has("clients.view") ? [{ to: "/admin/clients", label: "Clients" }] : []),
      ...(has("projects.view") ? [{ to: "/admin/projects", label: "Projects" }] : []),
      ...(has("services.view") ? [{ to: "/admin/services", label: "Services" }] : []),
      ...(has("pages.view") ? [{ to: "/admin/content", label: "Content" }] : []),
      ...(has("settings.view") ? [{ to: "/admin/settings", label: "Settings" }] : []),
      ...(has("security.view") ? [{ to: "/admin/security", label: "Security" }] : []),
      ...(has("audit.view") ? [{ to: "/admin/audit", label: "Audit Log" }] : []),
      ...(has("users.view") ? [{ to: "/admin/users", label: "Users" }] : []),
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
      switchTo={[{ to: "/account/security", label: "Your account" }]}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
