import { personNameSchema, setPasswordSchema } from "@shared/validation/auth";
import { fieldErrors } from "@shared/validation/common";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { acceptInvitation, getInvitationPreview } from "~/.server/auth/invitations";
import { homePathFor } from "~/.server/auth/login";
import { actionError, formString, load } from "~/.server/guards";
import { RecoveryCodes } from "~/components/account/RecoveryCodes";
import { Button, ErrorSummary, TextField } from "~/components/ui/forms";
import type { Route } from "./+types/invite";
import styles from "./auth.module.css";

export async function loader({ context, params }: Route.LoaderArgs) {
  const preview = await getInvitationPreview(load(context).server, params.token);
  return { invitation: preview ? { email: preview.email, name: preview.name } : null };
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
    const accepted = await acceptInvitation(server, params.token, {
      name: name.data,
      password: passwords.data.password,
    });
    return data(
      {
        ok: true as const,
        recoveryCodes: accepted.recoveryCodes,
        home: await homePathFor(server, accepted.userId),
      },
      { headers: { "Set-Cookie": accepted.session.cookie } },
    );
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Accept your invitation — VORA" }, { name: "robots", content: "noindex" }];
}

export default function Invite({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();

  if (result?.ok) {
    return (
      <div className={styles.card}>
        <h1>Welcome to VORA</h1>
        {result.recoveryCodes ? (
          <RecoveryCodes codes={result.recoveryCodes} continueTo={result.home} />
        ) : (
          <p>
            <Link to={result.home}>Continue</Link>
          </p>
        )}
      </div>
    );
  }

  if (!loaderData.invitation) {
    return (
      <div className={styles.card}>
        <h1>This invitation isn't valid</h1>
        <p className="muted">
          Invitations expire after 3 days and work once. Ask the person who invited you to send a
          new one.
        </p>
      </div>
    );
  }

  const fields = result && !result.ok ? result.fields : {};
  return (
    <div className={styles.card}>
      <h1>Accept your invitation</h1>
      <p className="muted">
        You're joining VORA as <strong>{loaderData.invitation.email}</strong>.
      </p>
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}
      <Form method="post" className={styles.form}>
        <TextField
          name="name"
          label="Your name"
          autoComplete="name"
          required
          defaultValue={loaderData.invitation.name ?? ""}
          error={fields.name}
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={12}
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
        <Button busy={navigation.state === "submitting"}>Create account</Button>
      </Form>
    </div>
  );
}
