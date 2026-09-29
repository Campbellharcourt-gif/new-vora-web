import { otpCodeSchema } from "@shared/validation/auth";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { homePathFor, resendSignInCode, verifySignInCode } from "~/.server/auth/login";
import { formString, load, safeNext } from "~/.server/guards";
import { Button, ErrorSummary, Notice, TextField } from "~/components/ui/forms";
import type { Route } from "./+types/login-verify";

export async function loader({ context }: Route.LoaderArgs) {
  const { pending, actor } = load(context);
  if (actor) throw redirect("/account");
  if (!pending) throw redirect("/login");
  // Show only a masked address: a***@domain.
  const [local = "", domain = ""] = pending.email.split("@");
  return {
    maskedEmail: `${local.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`,
  };
}

const MESSAGES: Record<string, string> = {
  invalid_code: "That code isn't right.",
  expired: "That code has expired. Send a new one.",
  too_many_attempts: "Too many incorrect codes. Please sign in again.",
  rate_limited: "Too many attempts. Please wait a minute.",
  session_expired: "Your sign-in expired. Please start again.",
};

type VerifyResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fields: Record<string, string> };

export async function action({ context, request }: Route.ActionArgs) {
  const { server, pending } = load(context);
  if (!pending) throw redirect("/login");
  const form = await request.formData();
  const next = safeNext(formString(form, "next"), "");

  if (formString(form, "intent") === "resend") {
    const sent = await resendSignInCode(server, pending);
    if (sent.ok) return data<VerifyResult>({ ok: true, message: "A new code is on its way." });
    const message =
      sent.reason === "cooldown"
        ? `Please wait ${"retryAfterSeconds" in sent ? sent.retryAfterSeconds : 60} seconds before requesting another code.`
        : sent.reason === "hourly_limit"
          ? "You've requested too many codes. Try again in an hour or use a recovery code."
          : "We couldn't send a code right now. Please try again shortly.";
    return data<VerifyResult>({ ok: false, message, fields: {} }, { status: 429 });
  }

  const code = otpCodeSchema.safeParse(formString(form, "code"));
  if (!code.success) {
    return data<VerifyResult>(
      {
        ok: false,
        message: "Enter the 6-digit code.",
        fields: { code: "Enter the 6-digit code." },
      },
      { status: 400 },
    );
  }
  const result = await verifySignInCode(server, pending, code.data);
  if (result.kind === "signed_in") {
    const destination = next || (await homePathFor(server, result.userId));
    return redirect(destination, { headers: { "Set-Cookie": result.session.cookie } });
  }
  if (result.code === "too_many_attempts" || result.code === "session_expired") {
    return redirect("/login");
  }
  const remaining = result.attemptsRemaining;
  return data<VerifyResult>(
    {
      ok: false,
      message: `${MESSAGES[result.code] ?? "That code isn't right."}${remaining ? ` ${remaining} attempt${remaining === 1 ? "" : "s"} left.` : ""}`,
      fields: { code: MESSAGES[result.code] ?? "That code isn't right." },
    },
    { status: 401 },
  );
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Enter your code — VORA" }, { name: "robots", content: "noindex" }];
}

export default function LoginVerify({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>() as VerifyResult | undefined;
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const busy = navigation.state === "submitting";
  const next = params.get("next") ?? "";
  return (
    <div className="v-auth__card">
      <h1 className="v-heading-l">Check your email</h1>
      <p className="v-body v-secondary">
        We sent a 6-digit code to <strong>{loaderData.maskedEmail}</strong>. It expires in 10
        minutes.
      </p>
      {params.get("sent") === "0" ? (
        <Notice tone="warning">
          We couldn't send the code. Use “Send a new code” to try again.
        </Notice>
      ) : null}
      {result?.ok ? <Notice tone="success">{result.message}</Notice> : null}
      {result && !result.ok ? <ErrorSummary message={result.message} /> : null}
      <Form method="post" className="v-form v-form--tight">
        <input type="hidden" name="next" value={next} />
        <TextField
          name="code"
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          autoFocus
          code
          error={result && !result.ok ? result.fields.code : undefined}
        />
        <Button busy={busy}>Verify and sign in</Button>
      </Form>
      <Form method="post">
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" name="intent" value="resend" busy={busy}>
          Send a new code
        </Button>
      </Form>
      <p className="v-auth__links">
        <Link to={`/login/recovery${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
          Use a recovery code instead
        </Link>
      </p>
    </div>
  );
}
