import { personNameSchema, setPasswordSchema } from "@shared/validation/auth";
import { fieldErrors } from "@shared/validation/common";
import { data, Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { acceptInvitation, getInvitationPreview } from "~/.server/auth/invitations";
import { homePathFor } from "~/.server/auth/login";
import { actionError, formString, load } from "~/.server/guards";
import { Button, ErrorSummary, TextField } from "~/components/ui/forms";
import type { Route } from "./+types/verify-email";

const ACCOUNT_LABEL: Record<string, string> = { client: "Client", member: "Member" };

export async function loader({ context, params }: Route.LoaderArgs) {
  const { server, actor } = load(context);
  if (actor) throw redirect("/account");
  const preview = await getInvitationPreview(server, params.token);
  if (!preview?.selfRegistration) return { registration: null };
  return {
    registration: {
      email: preview.email,
      name: preview.name,
      accountLabel: ACCOUNT_LABEL[preview.roleKeys[0] ?? ""] ?? "VORA",
    },
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const { server } = load(context);
  const form = await request.formData();
  const name = personNameSchema.safeParse(formString(form, "name"));
  const passwords = setPasswordSchema.safeParse({
    password: formString(form, "password"),
    confirmPassword: formString(form, "confirmPassword"),
  });
  if (!name.success || !passwords.success) {
    return data(
      {
        ok: false as const,
        message: "Please check the highlighted fields.",
        fields: {
          ...(name.success ? {} : { name: fieldErrors(name.error)._form ?? "Enter your name." }),
          ...(passwords.success ? {} : fieldErrors(passwords.error)),
        } as Record<string, string>,
      },
      { status: 400 },
    );
  }
  try {
    const accepted = await acceptInvitation(
      server,
      params.token,
      { name: name.data, password: passwords.data.password },
      { selfRegistration: true },
    );
    const home = await homePathFor(server, accepted.userId);
    return redirect(`${home}?welcome=1`, { headers: { "Set-Cookie": accepted.session.cookie } });
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Finish creating your account — VORA" }, { name: "robots", content: "noindex" }];
}

export default function VerifyEmail({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";

  if (!loaderData.registration) {
    return (
      <div className="v-auth__card">
        <h1 className="v-heading-l">This link isn't valid</h1>
        <p className="v-body v-secondary">
          Confirmation links expire after 24 hours and work once. You can start again — it only
          takes a moment.
        </p>
        <p className="v-auth__links">
          <Link to="/register">Create an account</Link>
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    );
  }

  const { registration } = loaderData;
  const fields = result && !result.ok ? result.fields : {};
  return (
    <div className="v-auth__card">
      <h1 className="v-heading-l">Choose your password</h1>
      <p className="v-body v-secondary">
        Your email <strong>{registration.email}</strong> is confirmed. Set a password to finish
        creating your {registration.accountLabel} account.
      </p>
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}
      <Form method="post" className="v-form v-form--tight">
        <TextField
          name="name"
          label="Your name"
          autoComplete="name"
          required
          defaultValue={registration.name ?? ""}
          error={fields.name}
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          hint="At least 12 characters. A short phrase of unrelated words works well."
          required
          error={fields.password}
        />
        <TextField
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          error={fields.confirmPassword}
        />
        <Button busy={busy}>{busy ? "Creating your account…" : "Create account"}</Button>
      </Form>
    </div>
  );
}
