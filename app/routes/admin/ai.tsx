import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { aiOverview } from "~/.server/ai/admin-tools";
import { actionError, failureFrom, load, requirePermission } from "~/.server/guards";
import { getSetting, setSetting } from "~/.server/services/settings";
import {
  Button,
  Checkbox,
  ErrorSummary,
  FormScope,
  Notice,
  TextField,
} from "~/components/ui/forms";
import { StatusIndicator } from "~/components/vora/primitives";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/ai";

/**
 * VORA AI: whether it's available and why not, the limits that keep it safe and affordable, and
 * what it has been used for. The API key is an environment variable — never shown or edited here.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "admin.access");
  return aiOverview(load(context).server, actor).catch((error) => {
    failureFrom(error);
    throw error;
  });
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "ai.manage");
  const { server } = load(context);
  const form = await request.formData();
  const n = (key: string) => Number(form.get(key));
  try {
    const current = await getSetting(server, "ai.config");
    await setSetting(server, actor, "ai.config", {
      ...current,
      adminEnabled: form.get("adminEnabled") === "on",
      publicEnabled: form.get("publicEnabled") === "on",
      model: String(form.get("model") ?? "").trim(),
      maxOutputTokens: n("maxOutputTokens"),
      maxInputChars: n("maxInputChars"),
      dailyRequestLimit: n("dailyRequestLimit"),
      dailyTokenLimit: n("dailyTokenLimit"),
      priceInputPerMTokUsd: n("priceInputPerMTokUsd"),
      priceOutputPerMTokUsd: n("priceOutputPerMTokUsd"),
    });
    return { ok: true as const, message: "VORA AI settings saved." };
  } catch (error) {
    const failure = actionError(error);
    return data(failure.data, failure.init ?? undefined);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "VORA AI — Admin — VORA" }];
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

export default function AiAdmin({ loaderData: d }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const c = d.config;
  const adminReady = d.configured && c.adminEnabled && d.flags.admin;
  const reasons = [
    !d.configured ? "no API key is set on the server (GEMINI_API_KEY)" : null,
    !c.adminEnabled ? "admin tools are switched off below" : null,
    !d.flags.admin ? "the ai.admin_tools feature is off (Settings › Features)" : null,
  ].filter(Boolean);
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="VORA AI"
        description="Server-side assistance for the team: enquiry summaries and draft suggestions. Nothing it writes is saved or sent without a person choosing to."
      />
      {result?.ok ? (
        <Notice tone="success" label="Saved">
          {result.message}
        </Notice>
      ) : null}
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}

      <Panel title="Status" flush>
        <ul className="v-list">
          <li>
            <strong>Admin tools</strong>
            <StatusIndicator kind={adminReady ? "ok" : "muted"}>
              {adminReady ? "Available" : "Off"}
            </StatusIndicator>
          </li>
          <li>
            <strong>Public assistant</strong>
            <StatusIndicator
              kind={d.configured && c.publicEnabled && d.flags.public ? "ok" : "muted"}
            >
              {d.configured && c.publicEnabled && d.flags.public ? "Available" : "Off"}
            </StatusIndicator>
          </li>
          <li>
            <span>
              <strong>Provider</strong>
              <span className="v-secondary">
                {" "}
                · {c.provider} · {c.model}
              </span>
            </span>
            <StatusIndicator kind={d.configured ? (d.circuitOpen ? "warn" : "ok") : "muted"}>
              {!d.configured
                ? "Not configured"
                : d.circuitOpen
                  ? "Paused after errors"
                  : "Configured"}
            </StatusIndicator>
          </li>
          {d.health ? (
            <li>
              <strong>Health check</strong>
              <StatusIndicator kind={d.health.ok ? "ok" : "down"}>
                {d.health.ok ? `Responding · ${d.health.latencyMs} ms` : "Not responding"}
              </StatusIndicator>
            </li>
          ) : null}
        </ul>
        {reasons.length > 0 ? (
          <div className="v-panel__body">
            <p className="v-body-s">Admin tools are off because {reasons.join("; ")}.</p>
          </div>
        ) : null}
      </Panel>

      <div className="v-panels v-panels--two">
        {d.usage ? (
          <Panel title="Usage">
            <dl className="v-dl">
              <dt>Today</dt>
              <dd className="v-data">
                {d.usage.today.requests} / {c.dailyRequestLimit} requests ·{" "}
                {d.usage.today.tokens.toLocaleString("en-AU")} /{" "}
                {c.dailyTokenLimit.toLocaleString("en-AU")} tokens
              </dd>
            </dl>
            {d.usage.week.length > 0 ? (
              <div className="v-tablewrap">
                <table className="v-table">
                  <caption className="v-label" style={{ textAlign: "left" }}>
                    Last 7 days
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Channel</th>
                      <th scope="col">Outcome</th>
                      <th scope="col" className="num">
                        Requests
                      </th>
                      <th scope="col" className="num">
                        Est. cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.usage.week.map((r) => (
                      <tr key={`${r.channel}-${r.status}`}>
                        <td>{r.channel}</td>
                        <td>{r.status.replaceAll("_", " ")}</td>
                        <td className="num">{r.requests}</td>
                        <td className="num">{usd(r.costMicroUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="v-body-s">No requests in the last 7 days.</p>
            )}
            <p className="v-body-s">Costs are estimates from the prices below, not a bill.</p>
          </Panel>
        ) : null}

        {d.can.manage ? (
          <Panel title="Limits and switches">
            <FormScope prefix="ai-config">
              <Form method="post" className="v-form v-form--tight">
                <Checkbox
                  name="adminEnabled"
                  label="Admin tools on"
                  defaultChecked={c.adminEnabled}
                />
                <Checkbox
                  name="publicEnabled"
                  label="Public “Ask VORA” assistant on"
                  defaultChecked={c.publicEnabled}
                />
                <TextField
                  name="model"
                  label="Model"
                  required
                  maxLength={64}
                  defaultValue={c.model}
                />
                <TextField
                  name="maxOutputTokens"
                  label="Longest reply (tokens)"
                  inputMode="numeric"
                  required
                  defaultValue={String(c.maxOutputTokens)}
                />
                <TextField
                  name="maxInputChars"
                  label="Longest message (characters)"
                  inputMode="numeric"
                  required
                  defaultValue={String(c.maxInputChars)}
                />
                <TextField
                  name="dailyRequestLimit"
                  label="Requests per day"
                  inputMode="numeric"
                  required
                  defaultValue={String(c.dailyRequestLimit)}
                />
                <TextField
                  name="dailyTokenLimit"
                  label="Tokens per day"
                  inputMode="numeric"
                  required
                  defaultValue={String(c.dailyTokenLimit)}
                />
                <TextField
                  name="priceInputPerMTokUsd"
                  label="Input price per million tokens (USD)"
                  inputMode="numeric"
                  required
                  defaultValue={String(c.priceInputPerMTokUsd)}
                />
                <TextField
                  name="priceOutputPerMTokUsd"
                  label="Output price per million tokens (USD)"
                  inputMode="numeric"
                  required
                  defaultValue={String(c.priceOutputPerMTokUsd)}
                />
                <p className="v-body-s">
                  Turning features on also needs the matching switch in{" "}
                  <Link className="v-link" to="/admin/settings">
                    Settings › Features
                  </Link>{" "}
                  and the API key on the server.
                </p>
                <div>
                  <Button size="s" busy={busy}>
                    Save
                  </Button>
                </div>
              </Form>
            </FormScope>
          </Panel>
        ) : null}

        {d.usage && d.usage.recent.length > 0 ? (
          <Panel title="Recent requests" flush>
            <ul className="v-list">
              {d.usage.recent.map((r) => (
                <li key={r.id}>
                  <span>
                    {r.channel} · {r.status.replaceAll("_", " ")}
                    <span className="v-secondary"> · {r.userName ?? "visitor"}</span>
                  </span>
                  <span className="v-data v-secondary">{formatDateTime(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
