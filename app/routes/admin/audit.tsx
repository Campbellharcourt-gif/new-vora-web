import { Form, Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { listAudit } from "~/.server/services/activity";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/audit";

const TARGET_TYPES = [
  ["", "Everything"],
  ["user", "Users"],
  ["enquiry", "Enquiries"],
  ["client_org", "Clients"],
  ["engagement", "Client projects"],
  ["project", "Case studies"],
  ["service", "Services"],
  ["page", "Pages"],
  ["partner", "Partners"],
  ["job_role", "Careers"],
  ["setting", "Settings"],
  ["feature_flag", "Features"],
  ["role", "Roles"],
  ["privacy_request", "Privacy requests"],
  ["security_event", "Security events"],
] as const;

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "audit.view");
  const url = new URL(request.url);
  const targetType = url.searchParams.get("target") ?? "";
  const action = url.searchParams.get("action")?.slice(0, 60) ?? "";
  const actorUserId = url.searchParams.get("actor") ?? "";
  const before = Number(url.searchParams.get("before"));
  const result = await listAudit(load(context).server, actor, {
    ...(targetType ? { targetType } : {}),
    ...(action ? { action } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(Number.isFinite(before) && before > 0 ? { before } : {}),
    limit: 100,
  });
  return { ...result, targetType, action, actorUserId };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Audit log — Admin — VORA" }];
}

/** Changes are recorded without secrets; show field names and short values. */
function describeChanges(changes: Record<string, unknown> | null): string {
  if (!changes) return "";
  return Object.entries(changes)
    .slice(0, 5)
    .map(([key, value]) => {
      if (value && typeof value === "object" && "from" in value && "to" in value) {
        const { from, to } = value as { from: unknown; to: unknown };
        const short = (v: unknown) =>
          v === null || v === undefined
            ? "—"
            : typeof v === "object"
              ? "…"
              : String(v).slice(0, 40);
        return `${key}: ${short(from)} → ${short(to)}`;
      }
      return typeof value === "object" ? key : `${key}: ${String(value).slice(0, 40)}`;
    })
    .join(" · ");
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  const { items, nextBefore, targetType, action, actorUserId } = loaderData;
  const params = (extra: Record<string, string>) =>
    `?${new URLSearchParams({
      ...(targetType ? { target: targetType } : {}),
      ...(action ? { action } : {}),
      ...(actorUserId ? { actor: actorUserId } : {}),
      ...extra,
    })}`;
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Audit log"
        description="Who changed what, and when. Entries can't be edited or deleted, and never contain passwords, codes or keys."
      />
      <Form method="get" className="v-filters" aria-label="Filter the audit log">
        <div className="v-field">
          <label className="v-label" htmlFor="audit-target">
            Area
          </label>
          <span className="v-selectwrap">
            <select id="audit-target" name="target" className="v-select" defaultValue={targetType}>
              {TARGET_TYPES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="audit-action">
            Action starts with
          </label>
          <input
            id="audit-action"
            name="action"
            className="v-input"
            defaultValue={action}
            placeholder="user."
            maxLength={60}
          />
        </div>
        {actorUserId ? <input type="hidden" name="actor" value={actorUserId} /> : null}
        <button type="submit" className="v-btn v-btn--secondary v-btn--s">
          Filter
        </button>
        {targetType || action || actorUserId ? (
          <Link className="v-link v-body-s" to="/admin/audit">
            Clear
          </Link>
        ) : null}
      </Form>

      <Panel flush>
        {items.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">No entries match.</p>
          </div>
        ) : (
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Audit log</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="v-data">{formatDateTime(entry.createdAt)}</td>
                    <td data-label="Who">
                      {entry.actorUserId ? (
                        <Link to={params({ actor: entry.actorUserId })}>
                          {entry.actorName ?? "Former user"}
                        </Link>
                      ) : (
                        <span className="v-secondary">System</span>
                      )}
                    </td>
                    <td data-label="What">
                      {entry.summary}
                      {entry.changes ? (
                        <div className="v-body-s v-secondary">{describeChanges(entry.changes)}</div>
                      ) : null}
                    </td>
                    <td data-label="Action" className="v-data">
                      {entry.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {nextBefore ? (
        <nav className="v-pagination" aria-label="Pagination">
          <Link className="v-arrowlink" to={params({ before: String(nextBefore) })}>
            <span>Older entries</span>
          </Link>
        </nav>
      ) : null}
    </>
  );
}
