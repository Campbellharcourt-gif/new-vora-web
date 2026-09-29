import { newPasswordSchema } from "@shared/validation/auth";
import { data, Form, useActionData, useNavigation } from "react-router";
import {
  changePassword,
  elevate,
  getSecurityOverview,
  regenerateRecoveryCodes,
  revokeOtherSessions,
  revokeOwnSession,
} from "~/.server/auth/account";
import { failureFrom, formString, load, requireActor } from "~/.server/guards";
import { describeUserAgent } from "~/.server/lib/request-meta";
import { RecoveryCodes } from "~/components/account/RecoveryCodes";
import { Button, ErrorSummary, Notice, TextField } from "~/components/ui/forms";
import {
  EmptyState,
  formatDateTime,
  PageHeading,
  Panel,
} from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/security";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = requireActor(context, request);
  const overview = await getSecurityOverview(load(context).server, actor);
  return {
    ...overview,
    sessions: overview.sessions.map((s) => ({
      id: s.id,
      current: s.current,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
      device: describeUserAgent(s.userAgent ?? ""),
      location: [s.city, s.country].filter(Boolean).join(", ") || "Unknown location",
    })),
    history: overview.history.map((h) => ({
      outcome: h.outcome,
      createdAt: h.createdAt,
      device: describeUserAgent(h.userAgent ?? ""),
      location: [h.city, h.country].filter(Boolean).join(", ") || "Unknown location",
    })),
  };
}

type ActionResult =
  | { ok: true; intent: string; message?: string; codes?: string[] }
  | { ok: false; intent: string; message: string; fields: Record<string, string> };

export async function action({ context, request }: Route.ActionArgs) {
  const actor = requireActor(context, request);
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  try {
    switch (intent) {
      case "revoke-session":
        await revokeOwnSession(server, actor, formString(form, "sessionId"));
        return { ok: true, intent, message: "Session signed out." } satisfies ActionResult;
      case "revoke-others": {
        const count = await revokeOtherSessions(server, actor);
        return {
          ok: true,
          intent,
          message: `Signed out ${count} other session${count === 1 ? "" : "s"}.`,
        } satisfies ActionResult;
      }
      case "change-password": {
        const next = formString(form, "newPassword");
        const parsed = newPasswordSchema.safeParse(next);
        if (!parsed.success) {
          return data(
            {
              ok: false,
              intent,
              message: "Please check the highlighted fields.",
              fields: { newPassword: parsed.error.issues[0]?.message ?? "Invalid password." },
            } satisfies ActionResult,
            { status: 400 },
          );
        }
        if (next !== formString(form, "confirmPassword")) {
          return data(
            {
              ok: false,
              intent,
              message: "Please check the highlighted fields.",
              fields: { confirmPassword: "The passwords don't match." },
            } satisfies ActionResult,
            { status: 400 },
          );
        }
        await changePassword(server, actor, {
          currentPassword: formString(form, "currentPassword"),
          newPassword: next,
        });
        return {
          ok: true,
          intent,
          message: "Password changed. Other sessions were signed out.",
        } satisfies ActionResult;
      }
      case "elevate":
        await elevate(server, actor, formString(form, "password"));
        return {
          ok: true,
          intent,
          message: "Confirmed. You can now manage recovery codes for 10 minutes.",
        } satisfies ActionResult;
      case "regenerate-codes": {
        const codes = await regenerateRecoveryCodes(server, actor);
        return { ok: true, intent, codes } satisfies ActionResult;
      }
      default:
        return data(
          { ok: false, intent, message: "Unknown action.", fields: {} } satisfies ActionResult,
          { status: 400 },
        );
    }
  } catch (error) {
    const failure = failureFrom(error);
    return data(
      {
        ok: false,
        intent,
        message: failure.message,
        fields: failure.fields,
      } satisfies ActionResult,
      { status: failure.status },
    );
  }
}

const OUTCOME_LABEL: Record<string, string> = {
  success: "Signed in",
  mfa_passed: "Signed in with code",
  recovery_used: "Signed in with recovery code",
  bad_credentials: "Wrong password",
  mfa_failed: "Wrong code",
  locked: "Blocked (locked)",
  suspended: "Blocked (account unavailable)",
  rate_limited: "Blocked (too many attempts)",
  challenge_failed: "Blocked (security check)",
};

export default function Security({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const fieldsFor = (intent: string) =>
    result && !result.ok && result.intent === intent ? result.fields : {};

  return (
    <>
      <PageHeading
        eyebrow="Account"
        title="Security"
        description="Sessions, password, recovery codes and sign-in history."
      />
      {result?.ok && result.message ? <Notice tone="success">{result.message}</Notice> : null}
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}

      <Panel
        title="Signed-in sessions"
        actions={
          loaderData.sessions.length > 1 ? (
            <Form method="post">
              <input type="hidden" name="intent" value="revoke-others" />
              <Button variant="secondary" busy={busy}>
                Sign out all other sessions
              </Button>
            </Form>
          ) : null
        }
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">Location</th>
              <th scope="col">Last active</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loaderData.sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.device}
                  {s.current ? <strong> · This device</strong> : null}
                </td>
                <td>{s.location}</td>
                <td>{formatDateTime(s.lastSeenAt)}</td>
                <td>
                  {s.current ? null : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke-session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <Button variant="secondary" busy={busy}>
                        Sign out
                      </Button>
                    </Form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Change password">
        <Form method="post" className="stack" style={{ maxWidth: "28rem" }}>
          <input type="hidden" name="intent" value="change-password" />
          <TextField
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            error={fieldsFor("change-password").currentPassword}
          />
          <TextField
            name="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            error={fieldsFor("change-password").newPassword}
          />
          <TextField
            name="confirmPassword"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            error={fieldsFor("change-password").confirmPassword}
          />
          <Button busy={busy}>Change password</Button>
        </Form>
      </Panel>

      <Panel title="Recovery codes">
        {result?.ok && result.codes ? (
          <RecoveryCodes codes={result.codes} />
        ) : (
          <>
            <p>
              {loaderData.recoveryRemaining} unused recovery code
              {loaderData.recoveryRemaining === 1 ? "" : "s"}.
            </p>
            {loaderData.elevated ? (
              <Form method="post">
                <input type="hidden" name="intent" value="regenerate-codes" />
                <Button busy={busy}>Generate new recovery codes</Button>
              </Form>
            ) : (
              <Form method="post" className="stack" style={{ maxWidth: "28rem" }}>
                <input type="hidden" name="intent" value="elevate" />
                <TextField
                  name="password"
                  label="Confirm your password to manage recovery codes"
                  type="password"
                  autoComplete="current-password"
                  required
                  error={fieldsFor("elevate").password}
                />
                <Button variant="secondary" busy={busy}>
                  Confirm
                </Button>
              </Form>
            )}
          </>
        )}
      </Panel>

      <Panel title="Recent sign-in activity">
        {loaderData.history.length === 0 ? (
          <EmptyState>No sign-in activity recorded yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Result</th>
                <th scope="col">Device</th>
                <th scope="col">Location</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.history.map((h) => (
                <tr key={`${h.createdAt}-${h.outcome}`}>
                  <td>{formatDateTime(h.createdAt)}</td>
                  <td>{OUTCOME_LABEL[h.outcome] ?? h.outcome}</td>
                  <td>{h.device}</td>
                  <td>{h.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
