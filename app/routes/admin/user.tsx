import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { elevate } from "~/.server/auth/account";
import { isElevated } from "~/.server/auth/types";
import { actionError, failureFrom, formString, load, requirePermission } from "~/.server/guards";
import { grantableRoles } from "~/.server/services/roles";
import {
  getUserDetail,
  revokeSessionsForUser,
  setUserRoles,
  setUserStatus,
} from "~/.server/services/users";
import {
  Button,
  ChoiceGroup,
  ErrorSummary,
  FormScope,
  Notice,
  TextField,
} from "~/components/ui/forms";
import { StatusIndicator, type StatusKind } from "~/components/vora/primitives";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/user";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "users.view");
  const { server } = load(context);
  const detail = await getUserDetail(server, actor, params.id).catch((error) => {
    failureFrom(error);
    throw error;
  });
  return {
    ...detail,
    grantable: detail.can.assignRoles
      ? (await grantableRoles(server, actor)).map((r) => ({ key: r.key, label: r.name }))
      : [],
    elevated: isElevated(actor, server.clock.now()),
    isSelf: actor.userId === params.id,
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "users.view");
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  try {
    switch (intent) {
      case "elevate":
        await elevate(server, actor, formString(form, "password"));
        return { ok: true as const, intent, message: "Confirmed. You can change roles now." };
      case "roles":
        await setUserRoles(
          server,
          actor,
          params.id,
          form.getAll("roles").filter((v): v is string => typeof v === "string"),
        );
        return {
          ok: true as const,
          intent,
          message: "Roles saved. They'll sign in again with the new access.",
        };
      case "suspend":
      case "reactivate":
        await setUserStatus(
          server,
          actor,
          params.id,
          intent === "suspend" ? "suspended" : "active",
        );
        return {
          ok: true as const,
          intent: "status",
          message: intent === "suspend" ? "Suspended and signed out." : "Reactivated.",
        };
      case "revoke": {
        const count = await revokeSessionsForUser(server, actor, params.id);
        return {
          ok: true as const,
          intent,
          message: `Signed out of ${count} session${count === 1 ? "" : "s"}.`,
        };
      }
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
  return [{ title: `${loaderData?.user.name ?? "User"} — Admin — VORA` }];
}

const STATUS_KIND: Record<string, StatusKind> = {
  active: "ok",
  invited: "info",
  suspended: "warn",
  deactivated: "muted",
};

export default function UserDetail({ loaderData: d }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const u = d.user;
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

  return (
    <>
      <PageHeading
        title={u.name}
        crumbs={[{ to: "/admin/users", label: "Users" }]}
        actions={
          <StatusIndicator kind={STATUS_KIND[u.status] ?? "muted"}>{u.status}</StatusIndicator>
        }
      />
      <p className="v-body-s">
        {u.email} · joined {formatDateTime(u.createdAt)} · last sign-in{" "}
        {formatDateTime(u.lastLoginAt)}
      </p>
      {d.isSelf ? (
        <Notice tone="info" label="You">
          This is your own account. Manage it from{" "}
          <Link className="v-link" to="/account/security">
            your account security
          </Link>
          ; nobody can change their own roles or status.
        </Notice>
      ) : null}

      <div className="v-panels v-panels--detail">
        <div className="v-stack" style={{ gap: "var(--space-5)" }}>
          <Panel title="Access">
            {feedback("roles", "elevate")}
            <dl className="v-dl">
              <dt>Roles</dt>
              <dd>{d.roles.map((r) => r.name).join(", ") || "None"}</dd>
              <dt>Two-step sign-in</dt>
              <dd>{u.twoStep ? "On (emailed codes)" : "Off"}</dd>
              <dt>Email</dt>
              <dd>{u.emailVerifiedAt ? "Confirmed" : "Not confirmed"}</dd>
              <dt>Active sessions</dt>
              <dd className="v-data">{d.activeSessions}</dd>
            </dl>
            {d.can.assignRoles ? (
              d.elevated ? (
                <Form method="post" className="v-form v-form--tight">
                  <input type="hidden" name="intent" value="roles" />
                  <ChoiceGroup
                    type="checkbox"
                    name="roles"
                    label="Roles"
                    options={d.grantable}
                    defaultValues={d.roles.map((r) => r.key)}
                    hint="You can grant only roles below your own. Changing roles signs the person out."
                  />
                  <div>
                    <Button size="s" busy={busy}>
                      Save roles
                    </Button>
                  </div>
                </Form>
              ) : (
                <FormScope prefix="elevate">
                  <Form method="post" className="v-form v-form--tight">
                    <input type="hidden" name="intent" value="elevate" />
                    <TextField
                      name="password"
                      label="Confirm your password to change roles"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                    <div>
                      <Button variant="secondary" size="s" busy={busy}>
                        Confirm
                      </Button>
                    </div>
                  </Form>
                </FormScope>
              )
            ) : null}
          </Panel>

          {d.can.manage ? (
            <Panel title="Account controls">
              {feedback("status", "revoke")}
              <div className="v-actions">
                {u.status === "suspended" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="reactivate" />
                    <Button variant="secondary" size="s" busy={busy}>
                      Reactivate
                    </Button>
                  </Form>
                ) : u.status === "active" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="suspend" />
                    <Button variant="danger" size="s" busy={busy}>
                      Suspend
                    </Button>
                  </Form>
                ) : null}
                <Form method="post">
                  <input type="hidden" name="intent" value="revoke" />
                  <Button
                    variant="secondary"
                    size="s"
                    busy={busy}
                    disabled={d.activeSessions === 0}
                  >
                    Sign out everywhere
                  </Button>
                </Form>
              </div>
              <p className="v-body-s">
                Suspending signs the person out and blocks sign-in until reactivated.
              </p>
            </Panel>
          ) : null}

          {d.logins.length > 0 ? (
            <Panel title="Recent sign-ins" flush>
              <ul className="v-list">
                {d.logins.map((l) => (
                  <li key={l.id}>
                    <span>
                      {l.outcome.replaceAll("_", " ")}
                      <span className="v-secondary">
                        {" "}
                        · {[l.city, l.country].filter(Boolean).join(", ") || "unknown location"}
                      </span>
                    </span>
                    <span className="v-data v-secondary">{formatDateTime(l.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="v-panels__aside">
          {d.orgs.length > 0 ? (
            <Panel title="Client organisations" flush>
              <ul className="v-list">
                {d.orgs.map((o) => (
                  <li key={o.id}>
                    <Link to={`/admin/clients/${o.id}`}>{o.name}</Link>
                    <span className="v-secondary">{o.orgRole}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {d.activity.length > 0 ? (
            <Panel title="Activity">
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
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
