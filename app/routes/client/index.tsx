import { load, requirePermission } from "~/.server/guards";
import { listClientEngagements } from "~/.server/services/client-portal";
import { EmptyState, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/index";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "client_portal.access");
  return { engagements: await listClientEngagements(load(context).server, actor) };
}

export default function ClientHome({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Client portal" title="Your engagements" />
      {loaderData.engagements.length === 0 ? (
        <EmptyState>
          There are no engagements shared with you yet. Your VORA contact will add them here.
        </EmptyState>
      ) : (
        <Panel>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--space-3)" }}>
            {loaderData.engagements.map((e) => (
              <li key={e.id}>
                <strong>{e.name}</strong>{" "}
                <span className="muted">
                  · {e.orgName} · {e.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
