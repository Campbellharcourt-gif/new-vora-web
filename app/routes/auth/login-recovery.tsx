import { recoveryCodeSchema } from "@shared/validation/auth";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { verifySignInRecoveryCode } from "~/.server/auth/login";
import { formString, load, safeNext } from "~/.server/guards";
import { Button, ErrorSummary, TextField } from "~/components/ui/forms";
import type { Route } from "./+types/login-recovery";
import styles from "./auth.module.css";

export async function loader({ context }: Route.LoaderArgs) {
  const { pending, actor } = load(context);
  if (actor) throw redirect("/account");
  if (!pending) throw redirect("/login");
  return null;
}

export async function action({ context, request }: Route.ActionArgs) {
  const { server, pending } = load(context);
  if (!pending) throw redirect("/login");
  const form = await request.formData();
  const code = recoveryCodeSchema.safeParse(formString(form, "code"));
  if (!code.success) {
    return data({ message: "Enter a recovery code like ABCDE-12345." }, { status: 400 });
  }
  const result = await verifySignInRecoveryCode(server, pending, code.data);
  if (result.kind === "signed_in") {
    return redirect(safeNext(formString(form, "next"), "/account/security"), {
      headers: { "Set-Cookie": result.session.cookie },
    });
  }
  if (result.code === "too_many_attempts" || result.code === "session_expired")
    return redirect("/login");
  return data(
    {
      message:
        result.code === "rate_limited"
          ? "Too many attempts. Please wait a minute."
          : "That recovery code isn't valid or has already been used.",
    },
    { status: 401 },
  );
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Use a recovery code — VORA" }, { name: "robots", content: "noindex" }];
}

export default function LoginRecovery() {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  return (
    <div className={styles.card}>
      <h1>Use a recovery code</h1>
      <p className="muted">Each recovery code works once. We'll email you when one is used.</p>
      {result ? <ErrorSummary message={result.message} /> : null}
      <Form method="post" className={styles.form}>
        <input type="hidden" name="next" value={params.get("next") ?? ""} />
        <TextField
          name="code"
          label="Recovery code"
          autoComplete="one-time-code"
          maxLength={16}
          spellCheck={false}
          required
        />
        <Button busy={navigation.state === "submitting"}>Sign in</Button>
      </Form>
      <p className={styles.links}>
        <Link to="/login/verify">Back to email code</Link>
      </p>
    </div>
  );
}
