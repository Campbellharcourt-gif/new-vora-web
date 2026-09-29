import { ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES, type EnquiryStatus } from "@shared/enums";
import { Form, Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { listEnquiries } from "~/.server/services/enquiries";
import {
  EmptyState,
  formatDateTime,
  PageHeading,
  Panel,
} from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/enquiries";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "enquiries.view");
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = ENQUIRY_STATUSES.includes(statusParam as EnquiryStatus)
    ? (statusParam as EnquiryStatus)
    : undefined;
  const beforeParam = Number(url.searchParams.get("before"));
  const result = await listEnquiries(load(context).server, actor, {
    ...(status ? { status } : {}),
    ...(Number.isFinite(beforeParam) && beforeParam > 0 ? { before: beforeParam } : {}),
  });
  return { ...result, status: status ?? "" };
}

export default function Enquiries({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Enquiries" />
      <Panel>
        <Form
          method="get"
          className="stack"
          style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap" }}
        >
          <label style={{ display: "grid", gap: "var(--space-1)", fontSize: "var(--text-sm)" }}>
            Status
            <select
              name="status"
              defaultValue={loaderData.status}
              style={{ minHeight: "2.75rem", padding: "0 var(--space-3)" }}
            >
              <option value="">All</option>
              {ENQUIRY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ENQUIRY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" style={{ minHeight: "2.75rem", padding: "0 var(--space-4)" }}>
            Filter
          </button>
        </Form>
        {loaderData.items.length === 0 ? (
          <EmptyState>No enquiries{loaderData.status ? " with this status" : " yet"}.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">From</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/admin/enquiries/${e.id}`}>{e.reference}</Link>
                    {e.spamScore >= 50 ? <span className="muted"> · possible spam</span> : null}
                  </td>
                  <td>
                    {e.name}
                    {e.company ? <span className="muted"> · {e.company}</span> : null}
                  </td>
                  <td>{e.projectTypes.join(", ")}</td>
                  <td>{ENQUIRY_STATUS_LABELS[e.status]}</td>
                  <td>{formatDateTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loaderData.nextBefore ? (
          <p>
            <Link
              to={`?${new URLSearchParams({ ...(loaderData.status ? { status: loaderData.status } : {}), before: String(loaderData.nextBefore) })}`}
            >
              Older enquiries
            </Link>
          </p>
        ) : null}
      </Panel>
    </>
  );
}
