import { getRoleDefinition } from "@shared/permissions";
import { requireActor } from "~/.server/guards";
import { PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/index";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = requireActor(context, request);
  return {
    name: actor.name,
    email: actor.email,
    roles: actor.roles.map((key) => getRoleDefinition(key)?.name ?? key),
    privileged: actor.privileged,
  };
}

export default function AccountOverview({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Account" title={loaderData.name} description={loaderData.email} />
      <Panel title="Access">
        <p>
          Roles: <strong>{loaderData.roles.join(", ") || "None"}</strong>
        </p>
        {loaderData.privileged ? (
          <p className="muted">Your role requires two-step verification each time you sign in.</p>
        ) : null}
      </Panel>
    </>
  );
}
