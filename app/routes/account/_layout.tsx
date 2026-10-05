import { Outlet } from "react-router";
import { load, requireActor } from "~/.server/guards";
import { unreadNotificationCount } from "~/.server/services/notifications";
import { WorkspaceShell } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/_layout";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = requireActor(context, request);
  const unread = await unreadNotificationCount(load(context).server, actor);
  return {
    unread,
    user: { name: actor.name, email: actor.email },
    canAdmin: actor.permissions.has("admin.access"),
    canClient: actor.permissions.has("client_portal.access"),
    canMember: actor.permissions.has("member_portal.access"),
  };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Account — VORA" }, { name: "robots", content: "noindex" }];
}

export default function AccountLayout({ loaderData }: Route.ComponentProps) {
  const switchTo = [
    ...(loaderData.canAdmin ? [{ to: "/admin", label: "Admin" }] : []),
    ...(loaderData.canClient ? [{ to: "/client", label: "Client portal" }] : []),
    ...(loaderData.canMember ? [{ to: "/member", label: "Member area" }] : []),
  ];
  return (
    <WorkspaceShell
      area="Account"
      user={loaderData.user}
      nav={[
        { to: "/account", label: "Overview", end: true },
        { to: "/account/security", label: "Security" },
        {
          to: "/account/notifications",
          label: loaderData.unread > 0 ? `Notifications (${loaderData.unread})` : "Notifications",
        },
        { to: "/account/privacy", label: "Privacy" },
      ]}
      switchTo={switchTo}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
