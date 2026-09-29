import { Outlet } from "react-router";
import { requirePermission } from "~/.server/guards";
import { WorkspaceShell } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/_layout";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "client_portal.access");
  return { user: { name: actor.name, email: actor.email } };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Client portal — VORA" }, { name: "robots", content: "noindex" }];
}

export default function ClientLayout({ loaderData }: Route.ComponentProps) {
  return (
    <WorkspaceShell
      area="Client portal"
      user={loaderData.user}
      nav={[{ to: "/client", label: "Engagements", end: true }]}
      switchTo={[{ to: "/account/security", label: "Your account" }]}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
