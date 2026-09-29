import { personNameSchema, setPasswordSchema } from "@shared/validation/auth";
import { emailAddress, fieldErrors } from "@shared/validation/common";
import {
  createContext,
  data,
  Form,
  type ShouldRevalidateFunctionArgs,
  useActionData,
  useNavigation,
} from "react-router";
import { bootstrapOwner, isSetupAvailable } from "~/.server/auth/bootstrap";
import { actionError, formString, load } from "~/.server/guards";
import { RecoveryCodes } from "~/components/account/RecoveryCodes";
import { Button, ErrorSummary, TextField } from "~/components/ui/forms";
import type { Route } from "./+types/setup";
import styles from "./auth.module.css";

/**
 * Set by a successful setup for the rest of the same request (CP-2.1 · A1). Without it, a form
 * post without JavaScript re-runs the loader right after the action — in the same request — and
 * the loader, now seeing an Owner, answered 404: the one-time recovery codes and the session
 * cookie were lost even though the Owner had been created.
 */
const completedInThisRequest = createContext<boolean>(false);

/** One-time Owner bootstrap. 404 once an Owner exists or when no SETUP_TOKEN is configured. */
export async function loader({ context }: Route.LoaderArgs) {
  if (context.get(completedInThisRequest)) return null;
  if (!(await isSetupAvailable(load(context).server)))
    throw data({ message: "Not found" }, { status: 404 });
  return null;
}

/**
 * After a successful setup, the browser must not re-check this route: the Owner now exists, so
 * the check would answer 404 and replace the page before the recovery codes are shown
 * (CP-2.1 · A1). Every other submission revalidates as usual.
 */
export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if ((actionResult as { ok?: unknown } | undefined)?.ok === true) return false;
  return defaultShouldRevalidate;
}

export async function action({ context, request }: Route.ActionArgs) {
  const { server } = load(context);
  if (!(await isSetupAvailable(server))) throw data({ message: "Not found" }, { status: 404 });
  const form = await request.formData();
  const name = personNameSchema.safeParse(formString(form, "name"));
  const email = emailAddress.safeParse(formString(form, "email"));
  const passwords = setPasswordSchema.safeParse({
    password: formString(form, "password"),
    confirmPassword: formString(form, "confirmPassword"),
  });
  if (!name.success || !email.success || !passwords.success) {
    return data(
      {
        ok: false as const,
        message: "Please check the highlighted fields.",
        fields: {
          ...(name.success ? {} : { name: "Enter your name." }),
          ...(email.success ? {} : { email: "Enter a valid email address." }),
          ...(passwords.success ? {} : fieldErrors(passwords.error)),
        } as Record<string, string>,
      },
      { status: 400 },
    );
  }
  try {
    const result = await bootstrapOwner(server, {
      setupToken: formString(form, "setupToken"),
      name: name.data,
      email: email.data,
      password: passwords.data.password,
    });
    context.set(completedInThisRequest, true);
    return data(
      { ok: true as const, recoveryCodes: result.recoveryCodes },
      { headers: { "Set-Cookie": result.session.cookie } },
    );
  } catch (error) {
    return actionError(error);
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Set up VORA — Owner account" }, { name: "robots", content: "noindex" }];
}

export default function Setup() {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  if (result?.ok) {
    return (
      <div className={styles.card}>
        <h1>Owner account created</h1>
        <RecoveryCodes codes={result.recoveryCodes} continueTo="/admin" />
      </div>
    );
  }
  const fields = result && !result.ok ? result.fields : {};
  return (
    <div className={styles.card}>
      <h1>Create the Owner account</h1>
      <p className="muted">
        This page works once, with the setup token configured for this environment.
      </p>
      {result && !result.ok ? (
        <ErrorSummary message={result.message} fields={result.fields} />
      ) : null}
      <Form method="post" className={styles.form} autoComplete="off">
        <TextField
          name="setupToken"
          label="Setup token"
          type="password"
          required
          autoComplete="off"
        />
        <TextField name="name" label="Your name" autoComplete="name" required error={fields.name} />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={fields.email}
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
        <Button busy={navigation.state === "submitting"}>Create Owner account</Button>
      </Form>
    </div>
  );
}
