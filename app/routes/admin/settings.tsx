import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import { integrationStatus } from "~/.server/services/admin-workspace";
import { listFlagStates, setFeatureFlag } from "~/.server/services/flags";
import { getSetting, setSetting } from "~/.server/services/settings";
import {
  Button,
  Checkbox,
  ErrorSummary,
  FormScope,
  Notice,
  TextArea,
  TextField,
} from "~/components/ui/forms";
import { StatusIndicator } from "~/components/vora/primitives";
import { PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/settings";

/**
 * Site settings. Each form maps to one typed setting (validated by its schema in the settings
 * service, which also checks the permission). Secrets — API keys, passwords, tokens — are never
 * settings: they live in the environment, and this page shows only whether they are present.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "settings.view");
  const { server } = load(context);
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const [identity, emails, retention, maintenance, flags, integrations] = await Promise.all([
    getSetting(server, "site.identity"),
    getSetting(server, "contact.emails"),
    getSetting(server, "retention"),
    getSetting(server, "maintenance"),
    listFlagStates(server, actor),
    integrationStatus(server, actor),
  ]);
  return {
    identity,
    emails,
    retention,
    maintenance,
    maintenanceForced: server.config.maintenanceForced,
    flags,
    integrations,
    can: {
      settings: has("settings.manage"),
      maintenance: has("maintenance.manage"),
      flags: has("flags.manage"),
      ai: has("ai.manage") || has("ai.usage.view"),
    },
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "settings.view");
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  const s = (key: string) => formString(form, key).trim();
  const num = (key: string) => Number(formString(form, key));
  try {
    switch (intent) {
      case "identity":
        await setSetting(server, actor, "site.identity", {
          name: s("name"),
          tagline: s("tagline") || null,
          partnerLine: s("partnerLine") || null,
        });
        break;
      case "emails":
        await setSetting(server, actor, "contact.emails", {
          general: s("general").toLowerCase(),
          projects: s("projects").toLowerCase(),
          support: s("support").toLowerCase(),
          careers: s("careers").toLowerCase(),
        });
        break;
      case "retention":
        await setSetting(server, actor, "retention", {
          enquiryMonths: num("enquiryMonths"),
          applicationMonths: num("applicationMonths"),
          loginHistoryDays: num("loginHistoryDays"),
          aiAnonymousDays: num("aiAnonymousDays"),
          emailOutboxDays: num("emailOutboxDays"),
        });
        break;
      case "maintenance":
        await setSetting(server, actor, "maintenance", {
          enabled: formString(form, "enabled") === "on",
          message: s("message") || null,
        });
        break;
      case "flag":
        await setFeatureFlag(server, actor, s("key"), { enabled: s("enabled") === "on" });
        break;
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
    return { ok: true as const, intent, message: "Saved." };
  } catch (error) {
    const failure = actionError(error);
    return data({ ...failure.data, intent }, failure.init ?? undefined);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Settings — Admin — VORA" }];
}

const STATE_KIND = { configured: "ok", not_configured: "muted", development: "info" } as const;
const STATE_LABEL = {
  configured: "Configured",
  not_configured: "Not configured",
  development: "Development",
} as const;

export default function Settings({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
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
  const err = (intent: string, key: string) =>
    result && !result.ok && result.intent === intent ? result.fields[key] : undefined;

  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Settings"
        description="Site details, contact addresses, features and integrations. Secrets are never stored here."
      />

      <Panel title="Integrations" flush>
        <ul className="v-list">
          {d.integrations.map((i) => (
            <li key={i.name}>
              <span>
                <strong>{i.name}</strong>
                <span className="v-secondary"> · {i.detail}</span>
                <span className="v-secondary v-data"> · {i.env.join(", ")}</span>
              </span>
              <StatusIndicator kind={STATE_KIND[i.state]}>{STATE_LABEL[i.state]}</StatusIndicator>
            </li>
          ))}
        </ul>
        <div className="v-panel__body">
          <p className="v-body-s">
            Keys and secrets are set as environment variables on the server (names shown), never in
            the admin. Live checks for the database, storage and email are on{" "}
            <Link className="v-link" to="/admin/system">
              System
            </Link>
            {d.can.ai ? (
              <>
                ; AI limits and usage on{" "}
                <Link className="v-link" to="/admin/ai">
                  VORA AI
                </Link>
              </>
            ) : null}
            .
          </p>
        </div>
      </Panel>

      <div className="v-panels v-panels--two">
        <Panel title="Site">
          {feedback("identity")}
          <FormScope prefix="identity">
            <Form method="post" className="v-form v-form--tight">
              <input type="hidden" name="intent" value="identity" />
              <fieldset disabled={!d.can.settings} className="v-fieldset-plain">
                <TextField
                  name="name"
                  label="Site name"
                  required
                  maxLength={60}
                  defaultValue={d.identity.name}
                  error={err("identity", "site.identity")}
                />
                <TextField
                  name="tagline"
                  label="Home page tagline"
                  maxLength={160}
                  hint="Replaces “Design × Technology × Identity.” when set."
                  defaultValue={d.identity.tagline ?? ""}
                />
                <TextField
                  name="partnerLine"
                  label="Partnership line"
                  maxLength={120}
                  hint="Shown on the home page and in the footer. Leave empty to hide."
                  defaultValue={d.identity.partnerLine ?? ""}
                />
              </fieldset>
              {d.can.settings ? (
                <div>
                  <Button size="s" busy={busy}>
                    Save site details
                  </Button>
                </div>
              ) : null}
            </Form>
          </FormScope>
        </Panel>

        <Panel title="Contact addresses">
          {feedback("emails")}
          <FormScope prefix="emails">
            <Form method="post" className="v-form v-form--tight">
              <input type="hidden" name="intent" value="emails" />
              <fieldset disabled={!d.can.settings} className="v-fieldset-plain">
                {(
                  [
                    ["general", "General"],
                    ["projects", "Projects (enquiry replies)"],
                    ["support", "Support"],
                    ["careers", "Careers"],
                  ] as const
                ).map(([key, label]) => (
                  <TextField
                    key={key}
                    name={key}
                    label={label}
                    type="email"
                    required
                    defaultValue={d.emails[key]}
                  />
                ))}
              </fieldset>
              {err("emails", "contact.emails") ? (
                <p className="v-field__error">{err("emails", "contact.emails")}</p>
              ) : null}
              {d.can.settings ? (
                <div>
                  <Button size="s" busy={busy}>
                    Save addresses
                  </Button>
                </div>
              ) : null}
            </Form>
          </FormScope>
        </Panel>

        <Panel title="Features">
          {feedback("flag")}
          <ul className="v-list" style={{ marginInline: "calc(-1 * var(--space-5))" }}>
            {d.flags.map((f) => (
              <li key={f.key}>
                <span>
                  <strong className="v-data">{f.key}</strong>
                  <span className="v-secondary"> · {f.description}</span>
                  {f.narrowed ? <span className="v-secondary"> · limited by rules</span> : null}
                </span>
                {d.can.flags ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="flag" />
                    <input type="hidden" name="key" value={f.key} />
                    <input type="hidden" name="enabled" value={f.enabled ? "" : "on"} />
                    <Button variant="secondary" size="s" busy={busy}>
                      {f.enabled ? "Turn off" : "Turn on"}
                      <span className="v-sr"> {f.key}</span>
                    </Button>
                  </Form>
                ) : (
                  <StatusIndicator kind={f.enabled ? "ok" : "muted"}>
                    {f.enabled ? "On" : "Off"}
                  </StatusIndicator>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Maintenance mode">
          {feedback("maintenance")}
          {d.maintenanceForced ? (
            <Notice tone="warning" label="Forced">
              Maintenance is switched on by the server (MAINTENANCE_MODE) and can't be turned off
              here.
            </Notice>
          ) : null}
          <FormScope prefix="maintenance">
            <Form method="post" className="v-form v-form--tight">
              <input type="hidden" name="intent" value="maintenance" />
              <fieldset disabled={!d.can.maintenance} className="v-fieldset-plain">
                <TextArea
                  name="message"
                  label="Message for visitors"
                  rows={2}
                  maxLength={400}
                  defaultValue={d.maintenance.message ?? ""}
                />
                <Checkbox
                  name="enabled"
                  label="Show the maintenance page to visitors"
                  defaultChecked={d.maintenance.enabled}
                />
              </fieldset>
              {d.can.maintenance ? (
                <div>
                  <Button size="s" variant="secondary" busy={busy}>
                    Save maintenance
                  </Button>
                </div>
              ) : null}
            </Form>
          </FormScope>
        </Panel>

        <Panel title="Data retention">
          {feedback("retention")}
          <FormScope prefix="retention">
            <Form method="post" className="v-form v-form--tight">
              <input type="hidden" name="intent" value="retention" />
              <fieldset disabled={!d.can.settings} className="v-fieldset-plain">
                {(
                  [
                    ["enquiryMonths", "Enquiries (months)"],
                    ["applicationMonths", "Job applications (months)"],
                    ["loginHistoryDays", "Sign-in history (days)"],
                    ["aiAnonymousDays", "Anonymous AI conversations (days)"],
                    ["emailOutboxDays", "Email log (days)"],
                  ] as const
                ).map(([key, label]) => (
                  <TextField
                    key={key}
                    name={key}
                    label={label}
                    inputMode="numeric"
                    required
                    defaultValue={String(d.retention[key])}
                  />
                ))}
              </fieldset>
              {err("retention", "retention") ? (
                <p className="v-field__error">{err("retention", "retention")}</p>
              ) : null}
              {d.can.settings ? (
                <div>
                  <Button size="s" busy={busy}>
                    Save retention
                  </Button>
                </div>
              ) : null}
            </Form>
          </FormScope>
        </Panel>

        <Panel title="More settings">
          <ul className="v-list" style={{ marginInline: "calc(-1 * var(--space-5))" }}>
            <li>
              <Link to="/admin/content">Home page lines, announcement and social links</Link>
            </li>
            <li>
              <Link to="/admin/security">Security events and sign-in activity</Link>
            </li>
            <li>
              <Link to="/account/security">Your account security</Link>
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
