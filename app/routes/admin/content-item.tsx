import {
  CONTENT_ADMIN_PATH,
  CONTENT_FIELDS,
  CONTENT_LABELS,
  type ContentField,
  type ContentKind,
  contentKindFromPath,
  contentPublicPath,
} from "@shared/content/kinds";
import { data, Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { actionError, failureFrom, formString, load, requirePermission } from "~/.server/guards";
import {
  contentPermissions,
  getContent,
  partnerOptions,
  publishContent,
  restoreVersion,
  saveContent,
  setArchived,
  unpublishContent,
} from "~/.server/services/content-admin";
import {
  Button,
  Checkbox,
  ErrorSummary,
  FormScope,
  Notice,
  Select,
  TextArea,
  TextField,
} from "~/components/ui/forms";
import { ContentStatusTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/content-item";

/** One editor for every CMS type (the type comes from the URL: /admin/<type>/:id). */
function kindOf(request: Request): ContentKind {
  const kind = contentKindFromPath(new URL(request.url).pathname);
  if (!kind) throw data({ message: "Not found." }, { status: 404 });
  return kind;
}

function formValue(field: ContentField, row: Record<string, unknown>): string {
  if (field.name === "closesOn") {
    const at = row.closesAt;
    return typeof at === "number" ? new Date(at).toISOString().slice(0, 10) : "";
  }
  const value = row[field.name];
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "on" : "";
  return String(value);
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const kind = kindOf(request);
  const actor = await requirePermission(context, request, contentPermissions(kind).view);
  const { server } = load(context);
  const item = await getContent(server, actor, kind, params.id).catch((error) => {
    failureFrom(error);
    throw error;
  });
  const row = item.row;
  const fields = CONTENT_FIELDS[kind].filter((f) => f.kind !== "body");
  const values = Object.fromEntries(fields.map((f) => [f.name, formValue(f, row)]));
  const key = String(row.slug ?? row.key ?? "");
  const live = row.status === "published" || row.status === "open";
  return {
    kind,
    id: params.id,
    name: String(row.title ?? row.name ?? ""),
    key,
    status: String(row.status),
    archived: row.archivedAt !== null && row.archivedAt !== undefined,
    hasUnpublishedChanges: Boolean(row.hasUnpublishedChanges),
    publishedAt: (row.publishedAt as number | null) ?? null,
    updatedAt: row.updatedAt as number,
    values,
    bodyText: item.bodyText,
    versions: item.versions,
    can: item.can,
    publicPath: live ? contentPublicPath(kind, key) : null,
    partners:
      kind === "service"
        ? (await partnerOptions(server)).map((p) => ({ key: p.id, label: p.name }))
        : [],
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const kind = kindOf(request);
  const actor = await requirePermission(context, request, contentPermissions(kind).view);
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  try {
    switch (intent) {
      case "save": {
        const input: Record<string, string> = { body: formString(form, "body") };
        for (const field of CONTENT_FIELDS[kind]) {
          if (field.kind !== "body") input[field.name] = formString(form, field.name);
        }
        await saveContent(server, actor, kind, params.id, input);
        return { ok: true as const, message: "Draft saved. It isn't live until you publish." };
      }
      case "publish": {
        const { version } = await publishContent(
          server,
          actor,
          kind,
          params.id,
          formString(form, "note"),
        );
        return { ok: true as const, message: `Published as version ${version}.` };
      }
      case "unpublish":
        await unpublishContent(server, actor, kind, params.id);
        return { ok: true as const, message: "Taken off the site. The draft is kept." };
      case "archive":
      case "unarchive":
        await setArchived(server, actor, kind, params.id, intent === "archive");
        return {
          ok: true as const,
          message: intent === "archive" ? "Archived." : "Restored from the archive as a draft.",
        };
      case "restore": {
        const { version } = await restoreVersion(
          server,
          actor,
          kind,
          params.id,
          formString(form, "versionId"),
        );
        return {
          ok: true as const,
          message: `Restored as draft version ${version}. Publish it to make it live.`,
        };
      }
      default:
        return data(
          { ok: false as const, message: "Unknown action.", fields: {} as Record<string, string> },
          { status: 400 },
        );
    }
  } catch (error) {
    return actionError(error);
  }
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${loaderData?.name ?? "Edit"} — Admin — VORA` }];
}

const BODY_HELP = [
  ["## Heading", "a section heading (### and #### for smaller ones)"],
  ["- Item", "a bullet list (1. Item for a numbered list)"],
  ["> Quote", "a quote; > — Name on the last line credits it"],
  ["**bold**  *italic*", "emphasis"],
  ["[words](https://…)", "a link (https://, mailto: or a site path like /contact)"],
  ["---", "a divider"],
] as const;

export default function ContentItem({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
  const labels = CONTENT_LABELS[d.kind];
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busyIntent = navigation.state === "submitting" ? navigation.formData?.get("intent") : null;
  const [params] = useSearchParams();
  const failure = result && !result.ok ? result : null;
  const fields = failure?.fields ?? {};
  const editable = d.can.edit && !d.archived;
  const live = d.status === "published" || d.status === "open";
  const listPath = CONTENT_ADMIN_PATH[d.kind];
  const crumbs =
    d.kind === "page"
      ? [{ to: "/admin/content", label: "Content" }]
      : [{ to: listPath, label: labels.many }];

  return (
    <>
      <PageHeading
        title={d.name || labels.one}
        crumbs={crumbs}
        actions={
          <ContentStatusTag status={d.status} hasUnpublishedChanges={d.hasUnpublishedChanges} />
        }
      />
      <p className="v-body-s">
        Last saved {formatDateTime(d.updatedAt)}
        {d.publishedAt
          ? ` · last published ${formatDateTime(d.publishedAt)}`
          : " · never published"}
        {d.publicPath ? (
          <>
            {" · "}
            <a className="v-link" href={d.publicPath} target="_blank" rel="noopener">
              View live page
            </a>
          </>
        ) : null}
      </p>
      {params.get("created") === "1" && !result ? (
        <Notice tone="success" label="Created">
          Draft created. Add the details, save, then publish when it's ready.
        </Notice>
      ) : null}
      {result?.ok ? (
        <Notice tone="success" label="Done">
          {result.message}
        </Notice>
      ) : null}
      {failure ? <ErrorSummary message={failure.message} fields={failure.fields} /> : null}

      <div className="v-panels v-panels--detail">
        <Panel title={editable ? "Edit draft" : "Details"}>
          <FormScope prefix={`edit-${d.kind}`}>
            <Form method="post" className="v-form v-form--tight">
              <input type="hidden" name="intent" value="save" />
              <fieldset disabled={!editable} className="v-fieldset-plain">
                {CONTENT_FIELDS[d.kind].map((field) => (
                  <FieldInput
                    key={field.name}
                    field={field}
                    value={field.kind === "body" ? d.bodyText : (d.values[field.name] ?? "")}
                    error={fields[field.name]}
                    partners={d.partners}
                  />
                ))}
              </fieldset>
              {editable ? (
                <div>
                  <Button busy={busyIntent === "save"}>Save draft</Button>
                </div>
              ) : null}
            </Form>
          </FormScope>
          {editable ? (
            <details className="v-disclosure">
              <summary className="v-body-s">How to format content</summary>
              <dl className="v-dl">
                {BODY_HELP.map(([example, meaning]) => (
                  <div key={example} style={{ display: "contents" }}>
                    <dt className="v-data">{example}</dt>
                    <dd>{meaning}</dd>
                  </div>
                ))}
              </dl>
              <p className="v-body-s">
                Leave an empty line between paragraphs. Images and video blocks appear as [[block
                …]] lines — keep them as they are.
              </p>
            </details>
          ) : null}
        </Panel>

        <div className="v-panels__aside">
          {d.can.publish ? (
            <Panel title="Publishing">
              {d.archived ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="unarchive" />
                  <p className="v-body-s">Archived items are hidden here and on the site.</p>
                  <Button variant="secondary" size="s" busy={busyIntent === "unarchive"}>
                    Restore from archive
                  </Button>
                </Form>
              ) : (
                <>
                  <Form method="post" className="v-form v-form--tight">
                    <input type="hidden" name="intent" value="publish" />
                    <p className="v-body-s">
                      {live && !d.hasUnpublishedChanges
                        ? "The live version matches this draft."
                        : "Publishing makes the saved draft live and keeps a version you can return to. Unsaved edits aren't included."}
                    </p>
                    <TextField name="note" label="Version note" maxLength={200} />
                    <div>
                      <Button
                        size="s"
                        busy={busyIntent === "publish"}
                        disabled={live && !d.hasUnpublishedChanges}
                      >
                        {live ? "Publish changes" : "Publish"}
                      </Button>
                    </div>
                  </Form>
                  {live ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="unpublish" />
                      <Button variant="quiet" size="s" busy={busyIntent === "unpublish"}>
                        {d.kind === "job_role" ? "Close role" : "Unpublish"}
                      </Button>
                    </Form>
                  ) : null}
                  {d.kind !== "page" ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="archive" />
                      <Button variant="quiet" size="s" busy={busyIntent === "archive"}>
                        Archive
                      </Button>
                    </Form>
                  ) : null}
                </>
              )}
            </Panel>
          ) : null}

          <Panel title="Version history" flush>
            {d.versions.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">No versions yet.</p>
              </div>
            ) : (
              <ol className="v-versions">
                {d.versions.map((v) => (
                  <li key={v.id}>
                    <div>
                      <span className="v-data">v{v.version}</span>{" "}
                      <span className="v-body-s">
                        {v.kind === "published"
                          ? v.isLive
                            ? "Published · live"
                            : "Published"
                          : v.kind === "restored"
                            ? "Restored"
                            : "Draft"}
                      </span>
                      <div className="v-body-s v-secondary">
                        {formatDateTime(v.createdAt)}
                        {v.createdByName ? ` · ${v.createdByName}` : ""}
                        {v.note ? ` · ${v.note}` : ""}
                      </div>
                    </div>
                    {editable ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="restore" />
                        <input type="hidden" name="versionId" value={v.id} />
                        <Button
                          variant="quiet"
                          size="s"
                          busy={
                            busyIntent === "restore" &&
                            navigation.formData?.get("versionId") === v.id
                          }
                        >
                          Restore<span className="v-sr"> version {v.version}</span>
                        </Button>
                      </Form>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          {d.kind !== "page" ? (
            <p className="v-body-s">
              <Link className="v-link" to={listPath}>
                Back to {labels.many.toLowerCase()}
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function FieldInput(props: {
  field: ContentField;
  value: string;
  error?: string | undefined;
  partners: { key: string; label: string }[];
}) {
  const { field, value, error } = props;
  switch (field.kind) {
    case "body":
      return (
        <TextArea
          name="body"
          label={field.label}
          rows={18}
          maxLength={200_000}
          defaultValue={value}
          error={error}
          hint="Plain text with simple formatting — see “How to format content” below."
        />
      );
    case "textarea":
      return (
        <TextArea
          name={field.name}
          label={field.label}
          rows={3}
          maxLength={field.maxLength}
          counter={Boolean(field.maxLength)}
          defaultValue={value}
          error={error}
          hint={field.hint}
          required={field.required}
        />
      );
    case "select":
      return (
        <Select
          name={field.name}
          label={field.label}
          options={field.name === "partnerId" ? props.partners : (field.options ?? [])}
          defaultValue={value}
          error={error}
          hint={field.hint}
          required={field.required}
          placeholder={field.required ? "Choose…" : "None"}
        />
      );
    case "checkbox":
      return (
        <Checkbox
          name={field.name}
          label={field.label}
          defaultChecked={value === "on"}
          error={error}
        />
      );
    default:
      return (
        <TextField
          name={field.name}
          label={field.label}
          type={field.kind === "url" ? "url" : field.kind === "date" ? "date" : "text"}
          inputMode={field.kind === "number" ? "numeric" : undefined}
          maxLength={field.maxLength}
          defaultValue={value}
          error={error}
          hint={field.hint}
          required={field.required}
        />
      );
  }
}
