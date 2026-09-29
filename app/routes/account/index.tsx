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
      <PageHeading eyebrow="Account" title={loaderData.name} />
      <p className="v-data v-secondary">{loaderData.email}</p>
      <div className="v-panels v-panels--two">
        <Panel title="Access">
          <dl className="v-dl">
            <dt>Roles</dt>
            <dd>{loaderData.roles.join(", ") || "None"}</dd>
          </dl>
          {loaderData.privileged ? (
            <p className="v-body-s">
              Your role requires two-step verification each time you sign in.
            </p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
