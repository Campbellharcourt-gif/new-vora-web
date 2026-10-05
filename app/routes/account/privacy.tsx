import { data, Form, useActionData, useNavigation, useSearchParams } from "react-router";
import { elevate } from "~/.server/auth/account";
import { isElevated } from "~/.server/auth/types";
import { actionError, formString, load, requireActor } from "~/.server/guards";
import {
  cancelAccountDeletion,
  privacyOverview,
  requestAccountDeletion,
} from "~/.server/services/privacy";
import {
  Button,
  ErrorSummary,
  FormScope,
  Notice,
  TextArea,
  TextField,
} from "~/components/ui/forms";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/privacy";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = requireActor(context, request);
  const { server } = load(context);
  return {
    ...(await privacyOverview(server, actor)),
    elevated: isElevated(actor, server.clock.now()),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = requireActor(context, request);
  const { server } = load(context);
  const form = await request.formData();
  const intent = formString(form, "intent");
  try {
    switch (intent) {
      case "elevate":
        await elevate(server, actor, formString(form, "password"));
        return { ok: true as const, intent, message: "Confirmed." };
      case "delete":
        await requestAccountDeletion(server, actor, {
          confirmEmail: formString(form, "confirmEmail"),
          reason: formString(form, "reason"),
        });
        return {
          ok: true as const,
          intent,
          message: "Request received. We've emailed you a confirmation.",
        };
      case "cancel":
        await cancelAccountDeletion(server, actor);
        return { ok: true as const, intent, message: "Your deletion request was cancelled." };
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

export function meta(): Route.MetaDescriptors {
  return [{ title: "Privacy — Account — VORA" }];
}

const STATUS_LABEL: Record<string, string> = {
  received: "Received",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Closed",
};

export default function AccountPrivacy({ loaderData: d }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  const [params] = useSearchParams();
  const failure = result && !result.ok ? result : null;
  const confirmForm = (
    <FormScope prefix="privacy-elevate">
      <Form method="post" className="v-form v-form--tight">
        <input type="hidden" name="intent" value="elevate" />
        <TextField
          name="password"
          label="Confirm your password"
          type="password"
          autoComplete="current-password"
          required
          hint="Needed before downloading your data or asking for deletion."
        />
        <div>
          <Button variant="secondary" size="s" busy={busy}>
            Confirm
          </Button>
        </div>
      </Form>
    </FormScope>
  );

  return (
    <>
      <PageHeading
        eyebrow="Account"
        title="Privacy"
        description="See the information VORA holds for your account, download a copy, or ask for your account to be deleted."
      />
      {result?.ok ? (
        <Notice tone="success" label="Done">
          {result.message}
        </Notice>
      ) : null}
      {failure ? <ErrorSummary message={failure.message} fields={failure.fields} /> : null}
      {params.get("confirm") === "export" && !d.elevated ? (
        <Notice tone="info" label="Confirm">
          Confirm your password, then download your data.
        </Notice>
      ) : null}

      <div className="v-panels v-panels--two">
        <Panel title="Your account">
          <dl className="v-dl">
            <dt>Name</dt>
            <dd>{d.user.name}</dd>
            <dt>Email</dt>
            <dd>{d.user.email}</dd>
            <dt>Created</dt>
            <dd className="v-data">{formatDateTime(d.user.createdAt)}</dd>
            <dt>Last sign-in</dt>
            <dd className="v-data">{formatDateTime(d.user.lastLoginAt)}</dd>
          </dl>
          <p className="v-body-s">
            How VORA uses personal information is described in the{" "}
            <a className="v-link" href="/privacy">
              Privacy Policy
            </a>
            .
          </p>
        </Panel>

        <Panel title="Download your data">
          <p className="v-body-s">
            A file with your account details, roles, client organisations, enquiries sent from your
            email address, project messages you wrote, notifications and sign-in history. Passwords
            and security codes are never included.
          </p>
          {d.elevated ? (
            <Form method="post" action="/account/privacy/export" reloadDocument>
              <Button size="s">Download my data (JSON)</Button>
            </Form>
          ) : (
            confirmForm
          )}
        </Panel>

        <Panel title="Delete your account">
          {d.openDeletion ? (
            <>
              <p className="v-body">
                You asked for your account to be deleted on{" "}
                {formatDateTime(d.openDeletion.requestedAt)}. Status:{" "}
                {STATUS_LABEL[d.openDeletion.status] ?? d.openDeletion.status}.
              </p>
              {d.openDeletion.status === "received" ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="cancel" />
                  <Button variant="secondary" size="s" busy={busy}>
                    Cancel my request
                  </Button>
                </Form>
              ) : null}
            </>
          ) : d.elevated ? (
            <FormScope prefix="privacy-delete">
              <Form method="post" className="v-form v-form--tight">
                <input type="hidden" name="intent" value="delete" />
                <p className="v-body-s">
                  The VORA team reviews deletion requests and lets you know by email when it's done.
                  Once deleted, you can't sign in and the account can't be restored. If you also
                  want enquiries you sent removed, say so below.
                </p>
                <TextField
                  name="confirmEmail"
                  label="Type your email address to confirm"
                  type="email"
                  autoComplete="off"
                  required
                  error={failure?.intent === "delete" ? failure.fields.confirmEmail : undefined}
                />
                <TextArea name="reason" label="Anything we should know" rows={3} maxLength={1000} />
                <div>
                  <Button variant="danger" size="s" busy={busy}>
                    Ask to delete my account
                  </Button>
                </div>
              </Form>
            </FormScope>
          ) : (
            confirmForm
          )}
        </Panel>

        {d.requests.length > 0 ? (
          <Panel title="Your requests" flush>
            <ul className="v-list">
              {d.requests.map((r) => (
                <li key={r.id}>
                  <span>
                    {r.type === "export" ? "Data download" : "Account deletion"}
                    <span className="v-secondary"> · {STATUS_LABEL[r.status] ?? r.status}</span>
                  </span>
                  <span className="v-data v-secondary">{formatDateTime(r.requestedAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
