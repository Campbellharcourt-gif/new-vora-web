import { USER_STATUSES } from "@shared/enums";
import { emailAddress } from "@shared/validation/common";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { createInvitation } from "~/.server/auth/invitations";
import { canGrantRole } from "~/.server/auth/rbac";
import { failureFrom, formString, load, requirePermission } from "~/.server/guards";
import { grantableRoles, listRoles } from "~/.server/services/roles";
import { listUsers } from "~/.server/services/users";
import { Button, ChoiceGroup, ErrorSummary, Notice, TextField } from "~/components/ui/forms";
import { StatusIndicator, type StatusKind } from "~/components/vora/primitives";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/users";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "users.view");
  const { server } = load(context);
  const url = new URL(request.url);
  const filter = {
    q: url.searchParams.get("q")?.slice(0, 100) ?? "",
    role: url.searchParams.get("role") ?? "",
    status: url.searchParams.get("status") ?? "",
  };
  const [users, roles] = await Promise.all([
    listUsers(server, actor, filter),
    listRoles(server, actor),
  ]);
  const names = new Map(roles.map((r) => [r.key, r.name]));
  const grantable = actor.permissions.has("users.invite")
    ? (await grantableRoles(server, actor))
        .filter((r) => canGrantRole(actor, r.rank, r.key))
        .map((r) => ({ key: r.key, label: r.name }))
    : [];
  return {
    users: users.map((u) => ({ ...u, roles: u.roles.map((k) => names.get(k) ?? k) })),
    roleOptions: roles.map((r) => ({ key: r.key, label: r.name })),
    grantable,
    filter,
  };
}

type InviteResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fields: Record<string, string> };

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "users.invite");
  const form = await request.formData();
  const email = emailAddress.safeParse(formString(form, "email"));
  const roleKeys = form.getAll("roles").filter((v): v is string => typeof v === "string");
  if (!email.success) {
    return data<InviteResult>(
      {
        ok: false,
        message: "Enter a valid email address.",
        fields: { email: "Enter a valid email address." },
      },
      { status: 400 },
    );
  }
  if (roleKeys.length === 0) {
    return data<InviteResult>(
      {
        ok: false,
        message: "Choose at least one role.",
        fields: { roles: "Choose at least one role." },
      },
      { status: 400 },
    );
  }
  try {
    await createInvitation(load(context).server, actor, {
      email: email.data,
      name: formString(form, "name") || undefined,
      roleKeys,
    });
    return data<InviteResult>({ ok: true, message: `Invitation sent to ${email.data}.` });
  } catch (error) {
    const failure = failureFrom(error);
    return data<InviteResult>(
      { ok: false, message: failure.message, fields: failure.fields },
      { status: failure.status },
    );
  }
}

export default function Users({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>() as InviteResult | undefined;
  const busy = useNavigation().state === "submitting";
  return (
    <>
      <PageHeading
        eyebrow="Admin"
        title="Users"
        description="Everyone with an account: staff, clients and members."
        actions={
          <Link className="v-btn v-btn--secondary v-btn--s" to="/admin/roles">
            Roles and permissions
          </Link>
        }
      />
      <Form method="get" className="v-filters" aria-label="Filter users">
        <div className="v-field">
          <label className="v-label" htmlFor="users-q">
            Search
          </label>
          <input
            id="users-q"
            name="q"
            type="search"
            className="v-input"
            defaultValue={loaderData.filter.q}
            placeholder="Name or email"
          />
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="users-role">
            Role
          </label>
          <span className="v-selectwrap">
            <select
              id="users-role"
              name="role"
              className="v-select"
              defaultValue={loaderData.filter.role}
            >
              <option value="">All roles</option>
              {loaderData.roleOptions.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="users-status">
            Status
          </label>
          <span className="v-selectwrap">
            <select
              id="users-status"
              name="status"
              className="v-select"
              defaultValue={loaderData.filter.status}
            >
              <option value="">Any status</option>
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </span>
        </div>
        <button type="submit" className="v-btn v-btn--secondary v-btn--s">
          Filter
        </button>
      </Form>
      {result?.ok ? <Notice tone="success">{result.message}</Notice> : null}
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}

      <Panel title="People" flush>
        {loaderData.users.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">No one matches.</p>
          </div>
        ) : null}
        <div className="v-tablewrap">
          <table className="v-table v-table--stack">
            <caption className="v-sr">People</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Roles</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link to={`/admin/users/${u.id}`}>{u.name}</Link>
                  </td>
                  <td data-label="Email" style={{ overflowWrap: "anywhere" }}>
                    {u.email}
                  </td>
                  <td data-label="Roles">{u.roles.join(", ") || "—"}</td>
                  <td data-label="Status">
                    <StatusIndicator kind={USER_STATUS_KIND[u.status] ?? "muted"}>
                      {u.status}
                    </StatusIndicator>
                  </td>
                  <td data-label="Last sign-in" className="v-data">
                    {formatDateTime(u.lastLoginAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {loaderData.grantable.length > 0 ? (
        <Panel title="Invite someone">
          <Form method="post" className="v-form v-form--tight">
            <TextField
              name="email"
              label="Email"
              type="email"
              required
              error={result && !result.ok ? result.fields.email : undefined}
            />
            <TextField name="name" label="Name" />
            <ChoiceGroup
              type="checkbox"
              name="roles"
              label="Roles"
              required
              options={loaderData.grantable}
              error={result && !result.ok ? result.fields.roles : undefined}
            />
            <p className="v-body-s">
              You can only grant roles below your own. Staff, Manager, Admin and Owner accounts must
              use two-step verification.
            </p>
            <div>
              <Button busy={busy} size="s">
                Send invitation
              </Button>
            </div>
          </Form>
        </Panel>
      ) : null}
    </>
  );
}

const USER_STATUS_KIND: Record<string, StatusKind> = {
  active: "ok",
  invited: "info",
  suspended: "warn",
  deactivated: "muted",
};
