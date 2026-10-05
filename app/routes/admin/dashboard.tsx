import { CONTENT_ADMIN_PATH, CONTENT_LABELS } from "@shared/content/kinds";
import { Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { listAudit } from "~/.server/services/activity";
import {
  adminOverview,
  failedSignInsLastDay,
  recentUsers,
} from "~/.server/services/admin-workspace";
import { contentSummary } from "~/.server/services/content-admin";
import { listEngagements } from "~/.server/services/engagements";
import { enquiryCounts, listEnquiries } from "~/.server/services/enquiries";
import { systemHealth } from "~/.server/services/health";
import { EngagementStatusTag, EnquiryStatusTag, HealthTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/dashboard";

/**
 * The admin dashboard: what needs attention, for this person's permissions. Every module is
 * loaded only when the actor holds the permission behind it; the services re-check it.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  const { server } = load(context);
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const none = Promise.resolve(null);
  const [overview, enquiryStats, enquiries, projects, users, activity, content, health, failed] =
    await Promise.all([
      adminOverview(server, actor),
      has("enquiries.view") ? enquiryCounts(server, actor) : none,
      has("enquiries.view") ? listEnquiries(server, actor, { limit: 5 }) : none,
      has("engagements.view")
        ? listEngagements(server, actor).then((rows) =>
            rows
              .filter((r) => ["planning", "in_progress", "review"].includes(r.status))
              .slice(0, 6),
          )
        : none,
      has("users.view") ? recentUsers(server, actor, 6) : none,
      has("audit.view") ? listAudit(server, actor, { limit: 8 }) : none,
      contentSummary(server, actor),
      has("system.status")
        ? systemHealth(server).catch(() => ({ overall: "down" as const, components: [] }))
        : none,
      has("security.view") ? failedSignInsLastDay(server) : none,
    ]);
  const open = enquiryStats
    ? (enquiryStats.byStatus.received ?? 0) + (enquiryStats.byStatus.processing ?? 0)
    : null;
  return {
    name: actor.name,
    stats: [
      {
        label: "New enquiries · 7 days",
        value: enquiryStats?.last7Days ?? null,
        to: "/admin/enquiries",
      },
      { label: "Open enquiries", value: open, to: "/admin/enquiries?status=received" },
      {
        label: "Active client projects",
        value: overview.counts.activeProjects,
        to: "/admin/engagements",
      },
      { label: "Clients", value: overview.counts.clients, to: "/admin/clients" },
      { label: "New users · 7 days", value: overview.counts.newUsers7d, to: "/admin/users" },
      { label: "Failed sign-ins · 24 h", value: failed, to: "/admin/security" },
    ].filter((s) => s.value !== null),
    enquiries: enquiries?.items ?? null,
    projects,
    users,
    activity: activity?.items ?? null,
    content: content.filter((c) => c.unpublished > 0),
    health: health
      ? {
          overall: health.overall,
          components: health.components.map((c) => ({ name: c.name, state: c.state })),
        }
      : null,
    securityHigh: overview.counts.securityHigh24h,
  };
}

const HEALTH_LABEL: Record<string, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not configured",
};

export default function Dashboard({ loaderData: d }: Route.ComponentProps) {
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title={`Welcome, ${d.name.split(" ")[0]}`}
        description="What needs attention across VORA."
      />

      {d.securityHigh ? (
        <div className="v-notice" role="status">
          <span className="v-status v-status--down">Security</span>
          <div>
            {d.securityHigh} high-severity security {d.securityHigh === 1 ? "event" : "events"} in
            the last 24 hours.{" "}
            <Link className="v-link" to="/admin/security?severity=high">
              Review
            </Link>
          </div>
        </div>
      ) : null}

      {d.stats.length > 0 ? (
        <dl className="v-stats">
          {d.stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>
                <Link to={s.to}>{s.value}</Link>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="v-panels v-panels--two">
        {d.enquiries ? (
          <Panel
            title="Recent enquiries"
            flush
            actions={
              <Link className="v-link v-body-s" to="/admin/enquiries">
                All enquiries
              </Link>
            }
          >
            {d.enquiries.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">No enquiries yet.</p>
              </div>
            ) : (
              <ul className="v-list">
                {d.enquiries.map((e) => (
                  <li key={e.id}>
                    <span>
                      <Link to={`/admin/enquiries/${e.id}`}>{e.name}</Link>
                      <span className="v-secondary">
                        {e.company ? ` · ${e.company}` : ""} · {formatDateTime(e.createdAt)}
                      </span>
                    </span>
                    <EnquiryStatusTag status={e.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {d.projects ? (
          <Panel
            title="Active client projects"
            flush
            actions={
              <Link className="v-link v-body-s" to="/admin/engagements">
                All projects
              </Link>
            }
          >
            {d.projects.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">No active projects.</p>
              </div>
            ) : (
              <ul className="v-list">
                {d.projects.map((p) => (
                  <li key={p.id}>
                    <span>
                      <Link to={`/admin/engagements/${p.id}`}>{p.name}</Link>
                      <span className="v-secondary"> · {p.orgName}</span>
                    </span>
                    <EngagementStatusTag status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {d.users ? (
          <Panel
            title="Recent users"
            flush
            actions={
              <Link className="v-link v-body-s" to="/admin/users">
                All users
              </Link>
            }
          >
            <ul className="v-list">
              {d.users.map((u) => (
                <li key={u.id}>
                  <span>
                    <Link to={`/admin/users/${u.id}`}>{u.name}</Link>
                    <span className="v-secondary"> · {u.roles || "no role"}</span>
                  </span>
                  <span className="v-data v-secondary">{formatDateTime(u.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {d.activity ? (
          <Panel
            title="Recent activity"
            flush
            actions={
              <Link className="v-link v-body-s" to="/admin/audit">
                Audit log
              </Link>
            }
          >
            {d.activity.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">Nothing yet.</p>
              </div>
            ) : (
              <ul className="v-list">
                {d.activity.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.summary}
                      <span className="v-secondary"> · {a.actorName ?? "System"}</span>
                    </span>
                    <span className="v-data v-secondary">{formatDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {d.content.length > 0 ? (
          <Panel title="Unpublished changes" flush>
            <ul className="v-list">
              {d.content.map((c) => (
                <li key={c.kind}>
                  <Link to={c.kind === "page" ? "/admin/content" : CONTENT_ADMIN_PATH[c.kind]}>
                    {CONTENT_LABELS[c.kind].many}
                  </Link>
                  <span className="v-secondary">
                    {c.unpublished} of {c.total} with unpublished changes
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {d.health ? (
          <Panel
            title="System status"
            flush
            actions={
              <Link className="v-link v-body-s" to="/admin/system">
                Details
              </Link>
            }
          >
            <ul className="v-list">
              <li>
                <strong>Overall</strong>
                <HealthTag
                  state={d.health.overall}
                  label={HEALTH_LABEL[d.health.overall] ?? d.health.overall}
                />
              </li>
              {d.health.components.map((c) => (
                <li key={c.name}>
                  <span style={{ textTransform: "capitalize" }}>{c.name}</span>
                  <HealthTag state={c.state} label={HEALTH_LABEL[c.state] ?? c.state} />
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
