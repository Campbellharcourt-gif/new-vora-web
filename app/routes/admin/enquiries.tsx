import { ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES, type EnquiryStatus } from "@shared/enums";
import { Form, Link } from "react-router";
import { load, requirePermission } from "~/.server/guards";
import { listEnquiries } from "~/.server/services/enquiries";
import { EnquiryStatusTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/enquiries";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "enquiries.view");
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = ENQUIRY_STATUSES.includes(statusParam as EnquiryStatus)
    ? (statusParam as EnquiryStatus)
    : undefined;
  const q = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const assigned = url.searchParams.get("assigned") ?? "";
  const beforeParam = Number(url.searchParams.get("before"));
  const result = await listEnquiries(load(context).server, actor, {
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    ...(assigned ? { assigned } : {}),
    ...(Number.isFinite(beforeParam) && beforeParam > 0 ? { before: beforeParam } : {}),
  });
  return { ...result, status: status ?? "", q, assigned };
}

export default function Enquiries({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeading eyebrow="Admin" title="Enquiries" />
      <Form method="get" className="v-filters" aria-label="Filter enquiries">
        <div className="v-field">
          <label className="v-label" htmlFor="filter-q">
            Search
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            className="v-input"
            defaultValue={loaderData.q}
            maxLength={100}
            placeholder="Name, email, company, reference"
          />
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="filter-status">
            Status
          </label>
          <span className="v-selectwrap">
            <select
              id="filter-status"
              name="status"
              className="v-select"
              defaultValue={loaderData.status}
            >
              <option value="">All statuses</option>
              {ENQUIRY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ENQUIRY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="filter-assigned">
            Assigned
          </label>
          <span className="v-selectwrap">
            <select
              id="filter-assigned"
              name="assigned"
              className="v-select"
              defaultValue={loaderData.assigned}
            >
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </span>
        </div>
        <button type="submit" className="v-btn v-btn--secondary v-btn--s">
          Filter
        </button>
        {loaderData.q || loaderData.status || loaderData.assigned ? (
          <Link className="v-link v-body-s" to="/admin/enquiries">
            Clear
          </Link>
        ) : null}
      </Form>
      <Panel flush>
        {loaderData.items.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">
              {loaderData.q || loaderData.status || loaderData.assigned
                ? "No enquiries match."
                : "No enquiries yet."}
            </p>
          </div>
        ) : (
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Enquiries</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">From</th>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">Received</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link className="v-data" to={`/admin/enquiries/${e.id}`}>
                        {e.reference}
                      </Link>
                      {e.spamScore >= 50 ? (
                        <span className="v-body-s"> · possible spam</span>
                      ) : null}
                    </td>
                    <td data-label="From">
                      <span>
                        {e.name}
                        {e.company ? <span className="v-body-s"> · {e.company}</span> : null}
                      </span>
                    </td>
                    <td data-label="Project">{e.projectTypes.join(", ")}</td>
                    <td data-label="Status">
                      <EnquiryStatusTag status={e.status} />
                    </td>
                    <td data-label="Assigned">{e.assigneeName ?? "—"}</td>
                    <td data-label="Received" className="v-data">
                      {formatDateTime(e.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {loaderData.nextBefore ? (
        <nav className="v-pagination" aria-label="Pagination">
          <Link
            className="v-arrowlink"
            to={`?${new URLSearchParams({
              ...(loaderData.status ? { status: loaderData.status } : {}),
              ...(loaderData.q ? { q: loaderData.q } : {}),
              ...(loaderData.assigned ? { assigned: loaderData.assigned } : {}),
              before: String(loaderData.nextBefore),
            })}`}
          >
            <span>Older enquiries</span>
          </Link>
        </nav>
      ) : null}
    </>
  );
}
