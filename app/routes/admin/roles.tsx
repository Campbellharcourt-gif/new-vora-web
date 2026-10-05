import { data, Form, useActionData, useNavigation } from "react-router";
import { elevate } from "~/.server/auth/account";
import { isElevated } from "~/.server/auth/types";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import {
  deleteCustomRole,
  listRoles,
  permissionCatalogue,
  saveCustomRole,
} from "~/.server/services/roles";
import {
  Button,
  ChoiceGroup,
  ErrorSummary,
  FormScope,
  Notice,
  TextField,
} from "~/components/ui/forms";
import { StatusIndicator } from "~/components/vora/primitives";
import { PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/roles";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = await requirePermission(context, request, "users.view");
  const { server } = load(context);
  return {
    roles: await listRoles(server, actor),
    catalogue: permissionCatalogue(),
    canManage: actor.permissions.has("roles.manage"),
    elevated: isElevated(actor, server.clock.now()),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = await requirePermission(context, request, "roles.manage");
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  const id = formString(form, "id") || null;
  try {
    switch (intent) {
      case "elevate":
        await elevate(server, actor, formString(form, "password"));
        return { ok: true as const, intent, id, message: "Confirmed." };
      case "save":
        await saveCustomRole(server, actor, id, {
          name: formString(form, "name"),
          description: formString(form, "description"),
          rank: formString(form, "rank"),
          permissions: form.getAll("permissions").filter((v): v is string => typeof v === "string"),
        });
        return {
          ok: true as const,
          intent,
          id,
          message: id ? "Role saved. Everyone with it signs in again." : "Role created.",
        };
      case "delete":
        await deleteCustomRole(server, actor, formString(form, "id"));
        return { ok: true as const, intent, id, message: "Role deleted." };
      default:
        return data(
          {
            ok: false as const,
            intent,
            id,
            message: "Unknown action.",
            fields: {} as Record<string, string>,
          },
          { status: 400 },
        );
    }
  } catch (error) {
    const failure = actionError(error);
    return data({ ...failure.data, intent, id }, failure.init ?? undefined);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Roles — Admin — VORA" }];
}

type Catalogue = Route.ComponentProps["loaderData"]["catalogue"];

function RoleFields(props: {
  catalogue: Catalogue;
  defaults: { name: string; description: string; rank: string; permissions: string[] };
  errors: Record<string, string>;
}) {
  const { catalogue, defaults, errors } = props;
  return (
    <>
      <TextField
        name="name"
        label="Name"
        required
        maxLength={60}
        defaultValue={defaults.name}
        error={errors.name}
      />
      <TextField
        name="description"
        label="Description"
        maxLength={200}
        defaultValue={defaults.description}
      />
      <TextField
        name="rank"
        label="Rank"
        required
        inputMode="numeric"
        defaultValue={defaults.rank}
        hint="1–90. People can manage only those ranked below them (Staff 40, Manager 60, Admin 80)."
        error={errors.rank}
      />
      {catalogue.map((group) => (
        <ChoiceGroup
          key={group.category}
          type="checkbox"
          name="permissions"
          label={group.category}
          options={group.permissions.map((p) => ({ key: p.key, label: p.description }))}
          defaultValues={defaults.permissions.filter((p) =>
            group.permissions.some((g) => g.key === p),
          )}
        />
      ))}
      {errors.permissions ? <p className="v-field__error">{errors.permissions}</p> : null}
      <p className="v-body-s">
        A role that opens the admin workspace always requires two-step verification at sign-in.
      </p>
    </>
  );
}

export default function Roles({ loaderData: d }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const failure = result && !result.ok ? result : null;
  const errorsFor = (id: string | null) => (failure && failure.id === id ? failure.fields : {});
  const feedbackFor = (id: string | null) =>
    result && result.id === id && result.intent !== "elevate" ? (
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
        eyebrow="Users"
        title="Roles and permissions"
        crumbs={[{ to: "/admin/users", label: "Users" }]}
        description="What each role can do. System roles are fixed; Owners can add custom roles."
      />
      {result?.intent === "elevate" ? (
        result.ok ? (
          <Notice tone="success" label="Confirmed">
            You can edit roles for the next few minutes.
          </Notice>
        ) : (
          <ErrorSummary message={result.message} fields={result.fields} />
        )
      ) : null}

      {d.canManage && !d.elevated ? (
        <Panel title="Confirm it's you">
          <FormScope prefix="roles-elevate">
            <Form method="post" className="v-form v-form--tight">
              <input type="hidden" name="intent" value="elevate" />
              <TextField
                name="password"
                label="Your password"
                type="password"
                autoComplete="current-password"
                required
                hint="Needed before creating, changing or deleting roles."
              />
              <div>
                <Button variant="secondary" size="s" busy={busy}>
                  Confirm
                </Button>
              </div>
            </Form>
          </FormScope>
        </Panel>
      ) : null}

      {d.roles.map((role) => (
        <Panel
          key={role.id}
          title={role.name}
          actions={
            <span className="v-actions">
              <StatusIndicator kind={role.isSystem ? "muted" : "info"}>
                {role.isSystem ? "System" : "Custom"}
              </StatusIndicator>
              <span className="v-body-s v-data">rank {role.rank}</span>
            </span>
          }
        >
          {feedbackFor(role.id)}
          <p className="v-body-s">
            {role.description || "—"} · {role.holders} {role.holders === 1 ? "person" : "people"}
            {role.isPrivileged ? " · two-step required" : ""}
          </p>
          {!role.isSystem && d.canManage && d.elevated ? (
            <details className="v-disclosure">
              <summary>Edit {role.name}</summary>
              <FormScope prefix={`role-${role.id}`}>
                <Form method="post" className="v-form v-form--tight">
                  <input type="hidden" name="intent" value="save" />
                  <input type="hidden" name="id" value={role.id} />
                  <RoleFields
                    catalogue={d.catalogue}
                    defaults={{
                      name: role.name,
                      description: role.description,
                      rank: String(role.rank),
                      permissions: role.permissions,
                    }}
                    errors={errorsFor(role.id)}
                  />
                  <div className="v-actions">
                    <Button size="s" busy={busy}>
                      Save role
                    </Button>
                  </div>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={role.id} />
                  <Button variant="quiet" size="s" busy={busy} disabled={role.holders > 0}>
                    Delete {role.name}
                  </Button>
                </Form>
              </FormScope>
            </details>
          ) : (
            <details className="v-disclosure">
              <summary>{role.permissions.length} permissions</summary>
              <ul className="v-body-s" style={{ columns: "16rem", margin: 0 }}>
                {role.permissions.map((p) => (
                  <li key={p} className="v-data">
                    {p}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Panel>
      ))}

      {d.canManage && d.elevated ? (
        <Panel title="New custom role">
          {feedbackFor(null)}
          <FormScope prefix="role-new">
            <Form method="post" className="v-form v-form--tight">
              <input type="hidden" name="intent" value="save" />
              <RoleFields
                catalogue={d.catalogue}
                defaults={{ name: "", description: "", rank: "30", permissions: [] }}
                errors={errorsFor(null)}
              />
              <div>
                <Button size="s" busy={busy}>
                  Create role
                </Button>
              </div>
            </Form>
          </FormScope>
        </Panel>
      ) : null}
    </>
  );
}
