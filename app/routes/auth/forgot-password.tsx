import { forgotPasswordSchema } from "@shared/validation/auth";
import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { requestPasswordResetInBackground } from "~/.server/auth/password-reset";
import { formString, load } from "~/.server/guards";
import { Button, ErrorSummary, Notice, TextField } from "~/components/ui/forms";
import type { Route } from "./+types/forgot-password";
import styles from "./auth.module.css";

export async function action({ context, request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = forgotPasswordSchema.safeParse({ email: formString(form, "email") });
  if (!parsed.success)
    return data({ sent: false, message: "Enter a valid email address." }, { status: 400 });
  // Identical response — content AND timing — whether or not an account exists: the work
  // happens after the response is sent.
  requestPasswordResetInBackground(load(context).server, parsed.data.email);
  return { sent: true, message: "" };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Reset your password — VORA" }, { name: "robots", content: "noindex" }];
}

export default function ForgotPassword() {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <div className={styles.card}>
      <h1>Reset your password</h1>
      {result?.sent ? (
        <Notice tone="success">
          If an account exists for that email, we've sent a link to reset the password. It expires
          in 30 minutes.
        </Notice>
      ) : (
        <>
          <p className="muted">Enter your account email and we'll send you a reset link.</p>
          {result && !result.sent ? <ErrorSummary message={result.message} /> : null}
          <Form method="post" className={styles.form}>
            <TextField name="email" label="Email" type="email" autoComplete="email" required />
            <Button busy={navigation.state === "submitting"}>Send reset link</Button>
          </Form>
        </>
      )}
      <p className={styles.links}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
