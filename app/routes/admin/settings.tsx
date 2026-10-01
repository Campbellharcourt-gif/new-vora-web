import { load, requirePermission } from "~/.server/guards";
import { settingsOverview } from "~/.server/services/admin-workspace";
import { PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/settings";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { items: await settingsOverview(load(context).server, await requirePermission(context, request, "settings.view")) };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Settings" description="Configuration exposed through the existing typed settings service." />
      <div className="v-stack">
        {loaderData.items.map((item) => (
          <Panel key={item.key} title={item.key}>
            <pre className="v-message" style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(item.value, null, 2)}</pre>
            <p className="v-body-s">Changes remain server-authorised through the settings service. Editing controls will be added per setting as their UX is defined.</p>
          </Panel>
        ))}
      </div>
    </>
  );
}
