import { DEFAULT_ROLES, getRoleDefinition } from "@shared/permissions";
import { emailAddress } from "@shared/validation/common";
import { data, Form, useActionData, useNavigation } from "react-router";
import { createInvitation } from "~/.server/auth/invitations";
import { canGrantRole } from "~/.server/auth/rbac";
import { failureFrom, formString, load, requirePermission } from "~/.server/guards";
import { listUsers } from "~/.server/services/users";
import { Button, ChoiceGroup, ErrorSummary, Notice, TextField } from "~/components/ui/forms";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/users";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "users.view");
  const users = await listUsers(load(context).server, actor);
  const grantable = actor.permissions.has("users.invite")
    ? DEFAULT_ROLES.filter((r) => canGrantRole(actor, r.rank, r.key)).map((r) => ({
        key: r.key,
        label: r.name,
      }))
    : [];
  return {
    users: users.map((u) => ({ ...u, roles: u.roles.map((k) => getRoleDefinition(k)?.name ?? k) })),
    grantable,
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
      <PageHeading eyebrow="Admin" title="Users" />
      {result?.ok ? <Notice tone="success">{result.message}</Notice> : null}
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}

      <Panel title="People">
        <table>
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
                <td>{u.name}</td>
                <td style={{ overflowWrap: "anywhere" }}>{u.email}</td>
                <td>{u.roles.join(", ") || "—"}</td>
                <td>{u.status}</td>
                <td>{formatDateTime(u.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {loaderData.grantable.length > 0 ? (
        <Panel title="Invite someone">
          <Form method="post" className="stack" style={{ maxWidth: "32rem" }}>
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
            <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
              You can only grant roles below your own. Staff, Manager, Admin and Owner accounts must
              use two-step verification.
            </p>
            <Button busy={busy}>Send invitation</Button>
          </Form>
        </Panel>
      ) : null}
    </>
  );
}
