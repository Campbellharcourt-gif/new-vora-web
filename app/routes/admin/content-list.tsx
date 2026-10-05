import {
  CONTENT_ADMIN_PATH,
  CONTENT_FIELDS,
  CONTENT_LABELS,
  type ContentKind,
  contentKindFromPath,
  slugify,
} from "@shared/content/kinds";
import { data, Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import { contentPermissions, createContent, listContent } from "~/.server/services/content-admin";
import { Button, ErrorSummary, FormScope, Select, TextField } from "~/components/ui/forms";
import { ContentStatusTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/content-list";

/** One list screen for projects, services, partners and careers (the type comes from the URL). */
function kindOf(request: Request): Exclude<ContentKind, "page"> {
  const kind = contentKindFromPath(new URL(request.url).pathname);
  if (!kind || kind === "page") throw data({ message: "Not found." }, { status: 404 });
  return kind;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const kind = kindOf(request);
  const perms = contentPermissions(kind);
  const actor = await requirePermission(context, request, perms.view);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.slice(0, 80) ?? "";
  const archived = url.searchParams.get("archived") === "1";
  const items = await listContent(load(context).server, actor, kind, { q, archived });
  return {
    kind,
    items,
    q,
    archived,
    canCreate: perms.create ? actor.permissions.has(perms.create) : false,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const kind = kindOf(request);
  const perms = contentPermissions(kind);
  const actor = await requirePermission(context, request, perms.create ?? perms.edit);
  const form = await request.formData();
  const input: Record<string, string> = {};
  for (const field of CONTENT_FIELDS[kind]) {
    if (field.onCreate) input[field.name] = formString(form, field.name);
  }
  const nameField = kind === "service" || kind === "partner" ? "name" : "title";
  if (!input.slug?.trim()) input.slug = slugify(input[nameField] ?? "");
  try {
    const id = await createContent(load(context).server, actor, kind, input);
    return redirect(`${CONTENT_ADMIN_PATH[kind]}/${id}?created=1`);
  } catch (error) {
    return actionError(error);
  }
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  const label = loaderData ? CONTENT_LABELS[loaderData.kind].many : "Content";
  return [{ title: `${label} — Admin — VORA` }];
}

export default function ContentList({ loaderData }: Route.ComponentProps) {
  const { kind, items, q, archived, canCreate } = loaderData;
  const labels = CONTENT_LABELS[kind];
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const createFields = CONTENT_FIELDS[kind].filter((f) => f.onCreate);
  const base = CONTENT_ADMIN_PATH[kind];
  return (
    <>
      <PageHeading
        eyebrow="Content"
        title={labels.many}
        description={
          kind === "job_role"
            ? "Roles listed on the Careers page. A role is visible only while it's open."
            : `Drafts stay private until published. Publishing keeps a version you can return to.`
        }
      />
      <Form method="get" className="v-filters" aria-label={`Search ${labels.many.toLowerCase()}`}>
        <div className="v-field">
          <label className="v-label" htmlFor="content-q">
            Search
          </label>
          <input
            id="content-q"
            name="q"
            type="search"
            className="v-input"
            defaultValue={q}
            maxLength={80}
          />
        </div>
        {archived ? <input type="hidden" name="archived" value="1" /> : null}
        <button type="submit" className="v-btn v-btn--secondary v-btn--s">
          Search
        </button>
        <Link className="v-link v-body-s" to={archived ? base : `${base}?archived=1`}>
          {archived ? "Show current" : "Show archived"}
        </Link>
      </Form>

      <Panel title={archived ? `Archived ${labels.many.toLowerCase()}` : labels.many} flush>
        {items.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">
              {q
                ? "Nothing matches that search."
                : archived
                  ? "Nothing is archived."
                  : `No ${labels.many.toLowerCase()} yet.`}
            </p>
          </div>
        ) : (
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">{labels.many}</caption>
              <thead>
                <tr>
                  <th scope="col">{labels.one}</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`${base}/${item.id}`}>{item.name}</Link>
                      <span className="v-body-s v-secondary"> · {item.key}</span>
                    </td>
                    <td data-label="Status">
                      <ContentStatusTag
                        status={item.status}
                        hasUnpublishedChanges={item.hasUnpublishedChanges}
                      />
                    </td>
                    <td data-label="Updated" className="v-data">
                      {formatDateTime(item.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {canCreate && !archived ? (
        <Panel title={`New ${labels.one.toLowerCase()}`}>
          {result && !result.ok ? (
            <ErrorSummary message={result.message} fields={result.fields} />
          ) : null}
          <FormScope prefix={`new-${kind}`}>
            <Form method="post" className="v-form v-form--tight">
              {createFields.map((field) =>
                field.kind === "select" ? (
                  <Select
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    required={field.required}
                    options={field.options ?? []}
                    error={result && !result.ok ? result.fields[field.name] : undefined}
                  />
                ) : (
                  <TextField
                    key={field.name}
                    name={field.name}
                    label={field.label}
                    required={field.required && field.name !== "slug"}
                    maxLength={field.maxLength}
                    hint={
                      field.name === "slug"
                        ? "Optional — made from the name if left empty."
                        : field.hint
                    }
                    error={result && !result.ok ? result.fields[field.name] : undefined}
                  />
                ),
              )}
              <div>
                <Button busy={busy} size="s">
                  Create draft
                </Button>
              </div>
            </Form>
          </FormScope>
        </Panel>
      ) : null}
    </>
  );
}
