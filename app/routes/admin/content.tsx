import { CONTENT_ADMIN_PATH, CONTENT_LABELS } from "@shared/content/kinds";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { SOCIAL_PLATFORMS } from "~/.server/db/schema/governance";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import { contentSummary, listContent } from "~/.server/services/content-admin";
import { getSetting, setSetting } from "~/.server/services/settings";
import { deleteSocialLink, listSocialLinks, saveSocialLink } from "~/.server/services/social-links";
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
import type { Route } from "./+types/content";

/**
 * The Content hub: the fixed pages (Our Story and the legal pages), the home page lines, the
 * site announcement, social links, and the way into each content type. Every write goes through
 * a service that checks the permission itself.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  const { server } = load(context);
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const [pages, summary, home, announcement, socials] = await Promise.all([
    has("pages.view") ? listContent(server, actor, "page") : Promise.resolve(null),
    contentSummary(server, actor),
    getSetting(server, "home.copy"),
    getSetting(server, "site.announcement"),
    has("social.manage") ? listSocialLinks(server, actor) : Promise.resolve(null),
  ]);
  if (!pages && summary.length === 0 && !socials) {
    throw data({ message: "You don't have access to this area." }, { status: 403 });
  }
  return {
    pages,
    summary,
    home: has("pages.publish") ? home : null,
    announcement: has("pages.publish") ? announcement : null,
    socials,
    platforms: SOCIAL_PLATFORMS.map((p) => ({
      key: p,
      label: p === "x" ? "X" : p.charAt(0).toUpperCase() + p.slice(1),
    })),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  try {
    switch (intent) {
      case "home": {
        const approachLines = formString(form, "approachLines")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        await setSetting(server, actor, "home.copy", {
          approachLines,
          invitationLine: formString(form, "invitationLine").trim() || null,
        });
        return { ok: true as const, intent, message: "Home page lines are live." };
      }
      case "announcement": {
        const linkLabel = formString(form, "linkLabel").trim();
        const linkHref = formString(form, "linkHref").trim();
        await setSetting(server, actor, "site.announcement", {
          enabled: formString(form, "enabled") === "on",
          message: formString(form, "message").trim(),
          linkLabel: linkLabel || null,
          linkHref: linkHref || null,
        });
        return { ok: true as const, intent, message: "Announcement saved." };
      }
      case "social": {
        const id = formString(form, "id") || null;
        await saveSocialLink(server, actor, id, Object.fromEntries(form));
        return { ok: true as const, intent, message: id ? "Link saved." : "Link added." };
      }
      case "social-delete":
        await deleteSocialLink(server, actor, formString(form, "id"));
        return { ok: true as const, intent: "social", message: "Link removed." };
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


export default function Content({ loaderData }: Route.ComponentProps) {
  const { pages, summary, home, announcement, socials, platforms } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const feedback = (intent: string) =>
    result && result.intent === intent ? (
      result.ok ? (
        <Notice tone="success" label="Saved">
          {result.message}
        </Notice>
      ) : (
        <ErrorSummary message={result.message} fields={result.fields} />
      )
    ) : null;
  const fieldError = (intent: string, name: string) =>
    result && !result.ok && result.intent === intent ? result.fields[name] : undefined;

  return (
    <>
      <PageHeading
        eyebrow="Content"
        title="Content"
        description="Everything visitors read. Drafts stay private until published."
      />

      <div className="v-panels v-panels--three">
        {summary
          .filter((s) => s.kind !== "page")
          .map((s) => (
            <Panel key={s.kind} title={CONTENT_LABELS[s.kind].many}>
              <p className="v-display-m">{s.total}</p>
              <p className="v-body-s">
                {s.unpublished > 0 ? `${s.unpublished} with unpublished changes` : "All published"}
              </p>
              <Link className="v-arrowlink" to={CONTENT_ADMIN_PATH[s.kind]}>
                <span>Open {CONTENT_LABELS[s.kind].many.toLowerCase()}</span>
              </Link>
            </Panel>
          ))}
      </div>

      {pages ? (
        <Panel title="Pages" flush>
          <div className="v-tablewrap">
            <table className="v-table v-table--stack">
              <caption className="v-sr">Pages</caption>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/admin/content/pages/${p.id}`}>{p.name}</Link>
                      <span className="v-body-s v-secondary"> · /{p.key}</span>
                    </td>
                    <td data-label="Status">
                      <ContentStatusTag
                        status={p.status}
                        hasUnpublishedChanges={p.hasUnpublishedChanges}
                      />
                    </td>
                    <td data-label="Updated" className="v-data">
                      {formatDateTime(p.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <div className="v-panels">
        {home ? (
          <Panel title="Home page">
            {feedback("home")}
            <FormScope prefix="home-copy">
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="home" />
                <TextArea
                  name="approachLines"
                  label="Approach lines"
                  rows={3}
                  hint="One line per row, up to three. Wrap one phrase in *asterisks* to set it in italics."
                  defaultValue={home.approachLines.join("\n")}
                  error={fieldError("home", "home.copy")}
                />
                <TextField
                  name="invitationLine"
                  label="Closing invitation"
                  maxLength={160}
                  hint="The line above “Start a project”. Leave empty to keep the placeholder."
                  defaultValue={home.invitationLine ?? ""}
                />
                <p className="v-body-s">Changes here go live as soon as you save.</p>
                <div>
                  <Button busy={busy} size="s">
                    Save home page lines
                  </Button>
                </div>
              </Form>
            </FormScope>
          </Panel>
        ) : null}

        {announcement ? (
          <Panel title="Announcement">
            {feedback("announcement")}
            <FormScope prefix="announcement">
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="announcement" />
                <TextField
                  name="message"
                  label="Message"
                  maxLength={200}
                  defaultValue={announcement.message}
                  hint="One short line, shown above the site header on every public page."
                  error={fieldError("announcement", "site.announcement")}
                />
                <TextField
                  name="linkLabel"
                  label="Link label"
                  maxLength={60}
                  defaultValue={announcement.linkLabel ?? ""}
                />
                <TextField
                  name="linkHref"
                  label="Link address"
                  maxLength={300}
                  hint="A site path like /contact, or a full https:// link."
                  defaultValue={announcement.linkHref ?? ""}
                />
                <Checkbox
                  name="enabled"
                  label="Show the announcement"
                  defaultChecked={announcement.enabled}
                />
                <div>
                  <Button busy={busy} size="s">
                    Save announcement
                  </Button>
                </div>
              </Form>
            </FormScope>
          </Panel>
        ) : null}
      </div>

      {socials ? (
        <Panel title="Social links">
          {feedback("social")}
          {socials.length === 0 ? <p className="v-body-s">No social links yet.</p> : null}
          {socials.map((s) => (
            <details key={s.id} className="v-disclosure">
              <summary>
                {s.label}
                <span className="v-body-s v-secondary">
                  {" "}
                  · {s.isVisible ? "shown" : "hidden"} · {s.url}
                </span>
              </summary>
              <FormScope prefix={`social-${s.id}`}>
                <Form method="post" className="v-form v-form--tight">
                  <input type="hidden" name="intent" value="social" />
                  <input type="hidden" name="id" value={s.id} />
                  <SocialFields
                    platforms={platforms}
                    defaults={{
                      platform: s.platform,
                      label: s.label,
                      url: s.url,
                      handle: s.handle ?? "",
                      sortOrder: String(s.sortOrder),
                      isVisible: s.isVisible,
                    }}
                  />
                  <div className="v-actions">
                    <Button busy={busy} size="s">
                      Save link
                    </Button>
                  </div>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="social-delete" />
                  <input type="hidden" name="id" value={s.id} />
                  <Button variant="quiet" size="s" busy={busy}>
                    Remove {s.label}
                  </Button>
                </Form>
              </FormScope>
            </details>
          ))}
          <details className="v-disclosure">
            <summary>Add a social link</summary>
            <FormScope prefix="social-new">
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="social" />
                <SocialFields
                  platforms={platforms}
                  defaults={{
                    platform: "",
                    label: "",
                    url: "",
                    handle: "",
                    sortOrder: "0",
                    isVisible: true,
                  }}
                  errors={result && !result.ok && result.intent === "social" ? result.fields : {}}
                />
                <div>
                  <Button busy={busy} size="s">
                    Add link
                  </Button>
                </div>
              </Form>
            </FormScope>
          </details>
        </Panel>
      ) : null}
    </>
  );
}

function SocialFields(props: {
  platforms: { key: string; label: string }[];
  defaults: {
    platform: string;
    label: string;
    url: string;
    handle: string;
    sortOrder: string;
    isVisible: boolean;
  };
  errors?: Record<string, string>;
}) {
  const { defaults, errors = {} } = props;
  return (
    <>
      <Select
        name="platform"
        label="Platform"
        required
        options={props.platforms}
        defaultValue={defaults.platform}
        error={errors.platform}
      />
      <TextField
        name="label"
        label="Label"
        required
        maxLength={60}
        defaultValue={defaults.label}
        error={errors.label}
      />
      <TextField
        name="url"
        label="Link"
        type="url"
        required
        maxLength={500}
        defaultValue={defaults.url}
        error={errors.url}
      />
      <TextField name="handle" label="Handle" maxLength={80} defaultValue={defaults.handle} />
      <TextField
        name="sortOrder"
        label="Order"
        inputMode="numeric"
        defaultValue={defaults.sortOrder}
        error={errors.sortOrder}
      />
      <Checkbox name="isVisible" label="Show in the footer" defaultChecked={defaults.isVisible} />
    </>
  );
}
