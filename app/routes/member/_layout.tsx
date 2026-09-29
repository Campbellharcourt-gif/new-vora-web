import { Outlet } from "react-router";
import { requirePermission } from "~/.server/guards";
import { WorkspaceShell } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/_layout";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "member_portal.access");
  return { user: { name: actor.name, email: actor.email } };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Member area — VORA" }, { name: "robots", content: "noindex" }];
}

export default function MemberLayout({ loaderData }: Route.ComponentProps) {
  return (
    <WorkspaceShell
      area="Members"
      user={loaderData.user}
      nav={[{ to: "/member", label: "Home", end: true }]}
      switchTo={[{ to: "/account/security", label: "Your account" }]}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
