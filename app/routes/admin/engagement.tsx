import {
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_STATUSES,
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUSES,
  type MilestoneStatus,
} from "@shared/enums";
import { data, Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { actionError, failureFrom, formString, load, requirePermission } from "~/.server/guards";
import { AppError } from "~/.server/lib/errors";
import {
  deleteEngagementFile,
  deleteMilestone,
  getEngagement,
  postEngagementUpdate,
  saveEngagement,
  saveMilestone,
  serviceOptions,
  setEngagementServices,
  setEngagementStaff,
  setFileVisibility,
  staffOptions,
  uploadEngagementFile,
} from "~/.server/services/engagements";
import {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
} from "~/.server/services/files";
import {
  Button,
  ChoiceGroup,
  ErrorSummary,
  FieldError,
  FormScope,
  Notice,
  Select,
  TextArea,
  TextField,
} from "~/components/ui/forms";
import { EngagementStatusTag, MilestoneStatusTag } from "~/components/workspace/status";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/engagement";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "engagements.view");
  const { server } = load(context);
  const detail = await getEngagement(server, actor, params.id).catch((error) => {
    failureFrom(error);
    throw error;
  });
  const [staff, services] = await Promise.all([
    detail.can.assign ? staffOptions(server) : Promise.resolve([]),
    detail.can.manage ? serviceOptions(server) : Promise.resolve([]),
  ]);
  return {
    ...detail,
    staffOptions: staff.map((s) => ({ key: s.id, label: s.name, description: s.email })),
    serviceOptions: services.map((s) => ({ key: s.id, label: s.name })),
    accept: ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(","),
    maxMb: MAX_UPLOAD_BYTES / 1024 / 1024,
  };
}

const ok = (intent: string, message: string) => ({ ok: true as const, intent, message });

export async function action({ context, request, params }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "engagements.view");
  const { server } = load(context);
  // Uploads: refuse oversized bodies before reading them.
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const length = Number(request.headers.get("content-length") ?? "NaN");
    if (!Number.isFinite(length) || length > MAX_UPLOAD_REQUEST_BYTES) {
      const failure = actionError(
        new AppError("payload_too_large", {
          message: `Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        }),
      );
      return data({ ...failure.data, intent: "upload" }, failure.init ?? undefined);
    }
  }
  const form = await request.formData();
  const intent = formString(form, "intent");
  const id = params.id;
  try {
    switch (intent) {
      case "save":
        await saveEngagement(server, actor, id, Object.fromEntries(form));
        return ok(intent, "Project saved.");
      case "staff":
        await setEngagementStaff(
          server,
          actor,
          id,
          form.getAll("staff").filter((v): v is string => typeof v === "string"),
        );
        return ok(intent, "Team updated.");
      case "services":
        await setEngagementServices(
          server,
          actor,
          id,
          form.getAll("services").filter((v): v is string => typeof v === "string"),
        );
        return ok(intent, "Services updated.");
      case "milestone":
        await saveMilestone(
          server,
          actor,
          id,
          formString(form, "milestoneId") || null,
          Object.fromEntries(form),
        );
        return ok(intent, "Milestone saved.");
      case "milestone-delete":
        await deleteMilestone(server, actor, id, formString(form, "milestoneId"));
        return ok("milestone", "Milestone removed.");
      case "update":
        await postEngagementUpdate(server, actor, id, {
          body: formString(form, "body"),
          visibility: formString(form, "visibility"),
        });
        return ok(
          intent,
          formString(form, "visibility") === "client"
            ? "Update posted. The client has been notified."
            : "Internal note added.",
        );
      case "upload": {
        const file = form.get("file");
        await uploadEngagementFile(server, actor, id, {
          file: file instanceof File ? file : null,
          label: formString(form, "label"),
          visibility: formString(form, "visibility"),
        });
        return ok(intent, "File uploaded.");
      }
      case "file-visibility":
        await setFileVisibility(
          server,
          actor,
          id,
          formString(form, "fileId"),
          formString(form, "visibility"),
        );
        return ok("files", "File sharing updated.");
      case "file-delete":
        await deleteEngagementFile(server, actor, id, formString(form, "fileId"));
        return ok("files", "File deleted.");
      default:
        return data(
          {
            ok: false as const,
            intent,
            message: "Unknown action.",
            fields: {} as Record<string, string>,
          },
          { status: 400 },
        );
    }
  } catch (error) {
    const failure = actionError(error);
    return data({ ...failure.data, intent }, failure.init ?? undefined);
  }
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${loaderData?.engagement.name ?? "Project"} — Admin — VORA` }];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const VISIBILITY_OPTIONS = [
  { key: "client", label: "Shared with the client" },
  { key: "internal", label: "Internal — VORA only" },
];

export default function EngagementDetail({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
  const e = d.engagement;
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const [params] = useSearchParams();
  const feedback = (...intents: string[]) =>
    result && intents.includes(result.intent) ? (
      result.ok ? (
        <Notice tone="success" label="Done">
          {result.message}
        </Notice>
      ) : (
        <ErrorSummary message={result.message} fields={result.fields} />
      )
    ) : null;
  const fieldError = (intent: string, name: string) =>
    result && !result.ok && result.intent === intent ? result.fields[name] : undefined;
  const manage = d.can.manage;

  return (
    <>
      <PageHeading
        title={e.name}
        crumbs={[
          { to: "/admin/engagements", label: "Client projects" },
          ...(d.can.assign ? [{ to: `/admin/clients/${d.org.id}`, label: d.org.name }] : []),
        ]}
        actions={<EngagementStatusTag status={e.status} />}
      />
      <p className="v-body-s">
        {d.org.name} · updated {formatDateTime(e.updatedAt)}
      </p>
      {params.get("created") === "1" && !result ? (
        <Notice tone="success" label="Created">
          Project created. Assign the team, add milestones, then share updates and files with the
          client.
        </Notice>
      ) : null}

      <div className="v-panels v-panels--detail">
        <div className="v-stack" style={{ gap: "var(--space-5)" }}>
          <Panel title="Details">
            {feedback("save")}
            {manage ? (
              <FormScope prefix="engagement">
                <Form method="post" className="v-form v-form--tight">
                  <input type="hidden" name="intent" value="save" />
                  <TextField
                    name="name"
                    label="Project name"
                    required
                    maxLength={160}
                    defaultValue={e.name}
                    error={fieldError("save", "name")}
                  />
                  <Select
                    name="status"
                    label="Status"
                    required
                    options={ENGAGEMENT_STATUSES.map((s) => ({
                      key: s,
                      label: ENGAGEMENT_STATUS_LABELS[s],
                    }))}
                    defaultValue={e.status}
                    hint="The client sees the status and is notified when it changes."
                  />
                  <TextArea
                    name="summary"
                    label="Summary (visible to the client)"
                    rows={3}
                    maxLength={1000}
                    defaultValue={e.summary ?? ""}
                    error={fieldError("save", "summary")}
                  />
                  <TextField
                    name="startDate"
                    label="Start date"
                    type="date"
                    defaultValue={e.startDate ?? ""}
                    error={fieldError("save", "startDate")}
                  />
                  <TextField
                    name="targetDate"
                    label="Target date"
                    type="date"
                    defaultValue={e.targetDate ?? ""}
                    error={fieldError("save", "targetDate")}
                  />
                  <div>
                    <Button busy={busy} size="s">
                      Save details
                    </Button>
                  </div>
                </Form>
              </FormScope>
            ) : (
              <dl className="v-dl">
                <dt>Summary</dt>
                <dd>{e.summary ?? "—"}</dd>
                <dt>Dates</dt>
                <dd>
                  {e.startDate ?? "—"} → {e.targetDate ?? "—"}
                </dd>
              </dl>
            )}
          </Panel>

          <Panel title="Milestones" flush>
            <div className="v-panel__body">{feedback("milestone")}</div>
            {d.milestones.length === 0 ? (
              <div className="v-panel__body">
                <p className="v-body-s">No milestones yet.</p>
              </div>
            ) : (
              <ul className="v-list">
                {d.milestones.map((m) => (
                  <li key={m.id}>
                    <span>
                      <strong>{m.title}</strong>
                      {m.dueDate ? <span className="v-secondary"> · due {m.dueDate}</span> : null}
                      {m.description ? (
                        <span className="v-secondary"> · {m.description}</span>
                      ) : null}
                    </span>
                    <span className="v-actions">
                      <MilestoneStatusTag status={m.status} />
                      {manage ? (
                        <>
                          <Form method="post" className="v-actions">
                            <input type="hidden" name="intent" value="milestone" />
                            <input type="hidden" name="milestoneId" value={m.id} />
                            <input type="hidden" name="title" value={m.title} />
                            <input type="hidden" name="description" value={m.description ?? ""} />
                            <input type="hidden" name="dueDate" value={m.dueDate ?? ""} />
                            <label className="v-sr" htmlFor={`ms-${m.id}`}>
                              Status of {m.title}
                            </label>
                            <span className="v-selectwrap">
                              <select
                                id={`ms-${m.id}`}
                                name="status"
                                className="v-select"
                                defaultValue={m.status}
                              >
                                {MILESTONE_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {MILESTONE_STATUS_LABELS[s]}
                                  </option>
                                ))}
                              </select>
                            </span>
                            <Button variant="secondary" size="s" busy={busy}>
                              Update<span className="v-sr"> {m.title}</span>
                            </Button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="milestone-delete" />
                            <input type="hidden" name="milestoneId" value={m.id} />
                            <Button variant="quiet" size="s" busy={busy}>
                              Remove<span className="v-sr"> {m.title}</span>
                            </Button>
                          </Form>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {manage ? (
              <div className="v-panel__body">
                <details className="v-disclosure">
                  <summary>Add a milestone</summary>
                  <FormScope prefix="milestone-new">
                    <Form method="post" className="v-form v-form--tight">
                      <input type="hidden" name="intent" value="milestone" />
                      <TextField
                        name="title"
                        label="Milestone"
                        required
                        maxLength={160}
                        error={fieldError("milestone", "title")}
                      />
                      <TextField name="description" label="Detail" maxLength={1000} />
                      <TextField name="dueDate" label="Due date" type="date" />
                      <Select
                        name="status"
                        label="Status"
                        required
                        options={MILESTONE_STATUSES.map((s) => ({
                          key: s,
                          label: MILESTONE_STATUS_LABELS[s as MilestoneStatus],
                        }))}
                        defaultValue="upcoming"
                      />
                      <div>
                        <Button size="s" busy={busy}>
                          Add milestone
                        </Button>
                      </div>
                    </Form>
                  </FormScope>
                </details>
              </div>
            ) : null}
          </Panel>

          <Panel title="Updates">
            {feedback("update")}
            {manage ? (
              <FormScope prefix="update">
                <Form method="post" className="v-form v-form--tight">
                  <input type="hidden" name="intent" value="update" />
                  <TextArea
                    name="body"
                    label="Write an update"
                    rows={4}
                    maxLength={10000}
                    required
                    error={fieldError("update", "body")}
                  />
                  <ChoiceGroup
                    type="radio"
                    name="visibility"
                    label="Who sees it"
                    options={VISIBILITY_OPTIONS}
                    defaultValues={["client"]}
                  />
                  <div>
                    <Button size="s" busy={busy}>
                      Post
                    </Button>
                  </div>
                </Form>
              </FormScope>
            ) : null}
            {d.updates.length === 0 ? (
              <p className="v-body-s">No updates yet.</p>
            ) : (
              <ol className="v-timeline">
                {d.updates.map((u) => (
                  <li key={u.id}>
                    <span className="v-data v-secondary">
                      {formatDateTime(u.createdAt)} · {u.authorName ?? "Former user"} ·{" "}
                      {u.visibility === "client" ? "shared" : "internal"}
                    </span>
                    <p className="v-message">{u.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Files" flush>
            <div className="v-panel__body">
              {feedback("upload", "files")}
              <p className="v-body-s">
                Files are private. Clients can download only the files shared with them; nothing
                here has a public link.
              </p>
            </div>
            {d.files.length > 0 ? (
              <ul className="v-list">
                {d.files.map((f) => (
                  <li key={f.id}>
                    <span>
                      <a className="v-link" href={`/api/v1/files/${f.id}`} download>
                        {f.label}
                      </a>
                      <span className="v-secondary">
                        {" "}
                        · {formatBytes(f.size)} ·{" "}
                        {f.visibility === "client" ? "shared" : "internal"} ·{" "}
                        {formatDateTime(f.createdAt)}
                      </span>
                    </span>
                    {manage ? (
                      <span className="v-actions">
                        <Form method="post">
                          <input type="hidden" name="intent" value="file-visibility" />
                          <input type="hidden" name="fileId" value={f.id} />
                          <input
                            type="hidden"
                            name="visibility"
                            value={f.visibility === "client" ? "internal" : "client"}
                          />
                          <Button variant="secondary" size="s" busy={busy}>
                            {f.visibility === "client" ? "Make internal" : "Share with client"}
                            <span className="v-sr"> — {f.label}</span>
                          </Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="file-delete" />
                          <input type="hidden" name="fileId" value={f.id} />
                          <Button variant="quiet" size="s" busy={busy}>
                            Delete<span className="v-sr"> {f.label}</span>
                          </Button>
                        </Form>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {manage ? (
              <div className="v-panel__body">
                <FormScope prefix="upload">
                  <Form
                    method="post"
                    encType="multipart/form-data"
                    className="v-form v-form--tight"
                  >
                    <input type="hidden" name="intent" value="upload" />
                    <div className="v-field">
                      <label className="v-field__label" htmlFor="upload-file">
                        File
                      </label>
                      <p className="v-field__hint" id="upload-file-hint">
                        Up to {d.maxMb} MB: {d.accept.replaceAll(",", ", ")}. Photo location and
                        camera details are removed.
                      </p>
                      <input
                        id="upload-file"
                        name="file"
                        type="file"
                        required
                        accept={d.accept}
                        className="v-input"
                        aria-describedby={
                          fieldError("upload", "file")
                            ? "upload-file-hint upload-file-error"
                            : "upload-file-hint"
                        }
                        aria-invalid={fieldError("upload", "file") ? true : undefined}
                      />
                      <FieldError id="upload-file" error={fieldError("upload", "file")} />
                    </div>
                    <TextField name="label" label="Label" maxLength={160} />
                    <ChoiceGroup
                      type="radio"
                      name="visibility"
                      label="Who can download it"
                      options={VISIBILITY_OPTIONS}
                      defaultValues={["internal"]}
                    />
                    <div>
                      <Button size="s" busy={busy}>
                        Upload
                      </Button>
                    </div>
                  </Form>
                </FormScope>
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="v-panels__aside">
          <Panel title="Team">
            {feedback("staff")}
            {d.can.assign ? (
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="staff" />
                <ChoiceGroup
                  type="checkbox"
                  name="staff"
                  label="Assigned VORA team"
                  options={d.staffOptions}
                  defaultValues={d.staff.map((s) => s.id)}
                />
                <div>
                  <Button variant="secondary" size="s" busy={busy}>
                    Save team
                  </Button>
                </div>
              </Form>
            ) : d.staff.length > 0 ? (
              <ul className="v-list">
                {d.staff.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
            ) : (
              <p className="v-body-s">No one is assigned yet.</p>
            )}
          </Panel>

          <Panel title="Services">
            {feedback("services")}
            {manage ? (
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="services" />
                <ChoiceGroup
                  type="checkbox"
                  name="services"
                  label="What VORA delivers"
                  options={d.serviceOptions}
                  defaultValues={d.services.map((s) => s.id)}
                />
                <div>
                  <Button variant="secondary" size="s" busy={busy}>
                    Save services
                  </Button>
                </div>
              </Form>
            ) : (
              <p className="v-body-s">{d.services.map((s) => s.name).join(", ") || "None yet."}</p>
            )}
          </Panel>

          <Panel title="Activity">
            {d.activity.length === 0 ? (
              <p className="v-body-s">Nothing yet.</p>
            ) : (
              <ol className="v-timeline">
                {d.activity.map((a) => (
                  <li key={a.id}>
                    <span className="v-data v-secondary">{formatDateTime(a.createdAt)}</span>
                    <span>
                      {a.summary}
                      {a.actorName ? <span className="v-secondary"> · {a.actorName}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <p className="v-body-s">
            <Link className="v-link" to="/admin/engagements">
              Back to client projects
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
