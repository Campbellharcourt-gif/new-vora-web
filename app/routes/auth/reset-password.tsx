import { setPasswordSchema } from "@shared/validation/auth";
import { fieldErrors } from "@shared/validation/common";
import { data, Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { completePasswordReset, isResetTokenValid } from "~/.server/auth/password-reset";
import { actionError, formString, load } from "~/.server/guards";
import { Button, ErrorSummary, TextField } from "~/components/ui/forms";
import type { Route } from "./+types/reset-password";
import styles from "./auth.module.css";

export async function loader({ context, params }: Route.LoaderArgs) {
  return { valid: await isResetTokenValid(load(context).server, params.token) };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = setPasswordSchema.safeParse({
    password: formString(form, "password"),
    confirmPassword: formString(form, "confirmPassword"),
  });
  if (!parsed.success) {
    return data(
      {
        ok: false as const,
        message: "Please check the highlighted fields.",
        fields: fieldErrors(parsed.error),
      },
      { status: 400 },
    );
  }
  try {
    await completePasswordReset(load(context).server, params.token, parsed.data.password);
  } catch (error) {
    return actionError(error);
  }
  return redirect("/login?reset=1");
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Choose a new password — VORA" }, { name: "robots", content: "noindex" }];
}

export default function ResetPassword({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  if (!loaderData.valid) {
    return (
      <div className={styles.card}>
        <h1>This link has expired</h1>
        <p className="muted">Reset links work once and expire after 30 minutes.</p>
        <p className={styles.links}>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </div>
    );
  }
  return (
    <div className={styles.card}>
      <h1>Choose a new password</h1>
      <p className="muted">
        Use at least 12 characters. A passphrase of a few unrelated words works well.
      </p>
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}
      <Form method="post" className={styles.form}>
        <TextField
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          error={result?.fields?.password}
        />
        <TextField
          name="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          error={result?.fields?.confirmPassword}
        />
        <Button busy={navigation.state === "submitting"}>Set password</Button>
      </Form>
    </div>
  );
}
