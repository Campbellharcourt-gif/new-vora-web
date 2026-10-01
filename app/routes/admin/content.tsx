import { load, requirePermission } from "~/.server/guards";
import { contentOverview } from "~/.server/services/admin-workspace";
import { PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/content";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { counts: await contentOverview(load(context).server, await requirePermission(context, request, "admin.access")) };
}

export default function Content({ loaderData }: Route.ComponentProps) {
  const modules = [
    ["Projects", loaderData.counts.projects, "/admin/projects"],
    ["Services", loaderData.counts.services, "/admin/services"],
    ["Pages", loaderData.counts.pages, null],
  ] as const;
  return (
    <>
      <PageHeading eyebrow="Admin" title="Content" description="One place to see the publishable surface of VORA." />
      <div className="v-panels v-panels--three">
        {modules.map(([label, value, to]) => (
          <Panel key={label} title={label}>
            <p className="v-display-m">{value ?? "—"}</p>
            {to ? <a className="v-arrowlink" href={to}><span>Open</span></a> : <p className="v-body-s">Page editing is queued for the next content slice.</p>}
          </Panel>
        ))}
      </div>
      <Panel title="Publication model">
        <p className="v-body">Working copies are edited privately. Public routes consume published snapshots only, so unfinished content never leaks onto the live site.</p>
      </Panel>
    </>
  );
}
