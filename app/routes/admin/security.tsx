import { SECURITY_SEVERITIES } from "@shared/enums";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import {
  acknowledgeSecurityEvent,
  listSecurityEvents,
  loginActivity,
} from "~/.server/services/admin-workspace";
import { Button, ErrorSummary, Notice } from "~/components/ui/forms";
import { StatusIndicator, type StatusKind } from "~/components/vora/primitives";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/security";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "security.view");
  const { server } = load(context);
  const url = new URL(request.url);
  const severity = url.searchParams.get("severity") ?? "";
  const type = url.searchParams.get("type")?.slice(0, 60) ?? "";
  const before = Number(url.searchParams.get("before"));
  const failuresOnly = url.searchParams.get("logins") !== "all";
  const [events, logins] = await Promise.all([
    listSecurityEvents(server, actor, {
      severity,
      type,
      ...(Number.isFinite(before) && before > 0 ? { before } : {}),
    }),
    loginActivity(server, actor, { failuresOnly }),
  ]);
  return {
    events,
    logins,
    severity,
    type,
    failuresOnly,
    canManage: actor.permissions.has("security.manage"),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "security.manage");
  const form = await request.formData();
  try {
    await acknowledgeSecurityEvent(
      load(context).server,
      actor,
      formString(form, "eventId"),
      formString(form, "note"),
    );
    return { ok: true as const, message: "Acknowledged." };
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Security — Admin — VORA" }];
}

const SEVERITY_KIND: Record<string, StatusKind> = {
  info: "muted",
  low: "info",
  medium: "warn",
  high: "down",
  critical: "down",
};

/** Details are already redacted at write time; show them as compact key: value text. */
function describe(details: Record<string, unknown> | null): string {
  if (!details) return "";
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
    .join(" · ");
}

export default function Security({ loaderData }: Route.ComponentProps) {
  const { events, logins, severity, type, failuresOnly, canManage } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const query = (extra: Record<string, string>) =>
    `?${new URLSearchParams({
      ...(severity ? { severity } : {}),
      ...(type ? { type } : {}),
      ...(failuresOnly ? {} : { logins: "all" }),
      ...extra,
    })}`;
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Security"
        description="Security events, sign-in activity and failed attempts. Sessions for a person are managed from their user page."
      />
      {result?.ok ? (
        <Notice tone="success" label="Done">
          {result.message}
        </Notice>
      ) : null}
      {result && !result.ok ? <ErrorSummary message={result.message} /> : null}

      <Form method="get" className="v-filters" aria-label="Filter security events">
        <div className="v-field">
          <label className="v-label" htmlFor="sec-severity">
            Severity
          </label>
          <span className="v-selectwrap">
            <select id="sec-severity" name="severity" className="v-select" defaultValue={severity}>
              <option value="">All</option>
              {SECURITY_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="sec-type">
            Type starts with
          </label>
          <input
            id="sec-type"
            name="type"
            className="v-input"
            defaultValue={type}
            placeholder="auth."
            maxLength={60}
          />
        </div>
        {failuresOnly ? null : <input type="hidden" name="logins" value="all" />}
        <button type="submit" className="v-btn v-btn--secondary v-btn--s">
          Filter
        </button>
      </Form>

      <Panel title="Security events" flush>
        {events.items.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">No events match.</p>
          </div>
        ) : (
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Security events</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Event</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Person</th>
                  <th scope="col">Review</th>
                </tr>
              </thead>
              <tbody>
                {events.items.map((e) => (
                  <tr key={e.id}>
                    <td className="v-data">{formatDateTime(e.createdAt)}</td>
                    <td data-label="Event">
                      <span className="v-data">{e.type}</span>
                      <div className="v-body-s v-secondary">
                        {describe(e.details)}
                        {e.country ? ` · ${e.country}` : ""}
                      </div>
                    </td>
                    <td data-label="Severity">
                      <StatusIndicator kind={SEVERITY_KIND[e.severity] ?? "muted"}>
                        {e.severity}
                      </StatusIndicator>
                    </td>
                    <td data-label="Person">
                      {e.userId ? (
                        <Link to={`/admin/users/${e.userId}`}>{e.userName ?? "Former user"}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Review">
                      {e.ackedAt ? (
                        <span className="v-body-s">Acknowledged</span>
                      ) : canManage && e.severity !== "info" ? (
                        <Form method="post">
                          <input type="hidden" name="eventId" value={e.id} />
                          <Button variant="quiet" size="s" busy={busy}>
                            Acknowledge<span className="v-sr"> {e.type}</span>
                          </Button>
                        </Form>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {events.nextBefore ? (
        <nav className="v-pagination" aria-label="Pagination">
          <Link className="v-arrowlink" to={query({ before: String(events.nextBefore) })}>
            <span>Older events</span>
          </Link>
        </nav>
      ) : null}

      <Panel
        title={failuresOnly ? "Failed sign-ins" : "Sign-in activity"}
        flush
        actions={
          <Link className="v-link v-body-s" to={failuresOnly ? "?logins=all" : "?"}>
            {failuresOnly ? "Show all sign-ins" : "Show failures only"}
          </Link>
        }
      >
        {logins.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">Nothing recorded.</p>
          </div>
        ) : (
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Sign-in activity</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Person</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Where</th>
                  <th scope="col" className="num">
                    Risk
                  </th>
                </tr>
              </thead>
              <tbody>
                {logins.map((l) => (
                  <tr key={l.id}>
                    <td className="v-data">{formatDateTime(l.createdAt)}</td>
                    <td data-label="Person">
                      {l.userId ? (
                        <Link to={`/admin/users/${l.userId}`}>{l.userName ?? "Former user"}</Link>
                      ) : (
                        <span className="v-secondary">Unknown address</span>
                      )}
                    </td>
                    <td data-label="Outcome">
                      <StatusIndicator kind={l.failed ? "warn" : "ok"}>
                        {l.outcome.replaceAll("_", " ")}
                      </StatusIndicator>
                    </td>
                    <td data-label="Where">
                      {[l.city, l.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td data-label="Risk" className="num">
                      {l.riskScore}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
