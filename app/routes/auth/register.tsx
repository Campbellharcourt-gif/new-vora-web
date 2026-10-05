import { registrationSchema } from "@shared/validation/auth";
import { fieldErrors } from "@shared/validation/common";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useRouteLoaderData,
} from "react-router";
import {
  isRegistrationOpen,
  REGISTRATION_POLICY,
  startRegistrationInBackground,
} from "~/.server/auth/registration";
import { formString, load } from "~/.server/guards";
import { HOUR } from "~/.server/lib/time";
import { recordSecurityEvent } from "~/.server/observability/security-events";
import { issueFormToken, verifyFormToken } from "~/.server/services/form-token";
import { checkRateLimit } from "~/.server/services/rate-limit";
import { verifyTurnstile } from "~/.server/services/turnstile";
import {
  Button,
  Checkbox,
  ChoiceGroup,
  ErrorSummary,
  FormScope,
  Notice,
  TextField,
} from "~/components/ui/forms";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/register";

const FORM = "register";

const ACCOUNT_TYPES = [
  {
    key: "client",
    label: "Client",
    description:
      "For VORA clients who need access to their projects, updates, files and account information.",
  },
  {
    key: "member",
    label: "Member",
    description: "For VORA members who need access to member resources and their account.",
  },
] as const;

export async function loader({ context }: Route.LoaderArgs) {
  const { actor, server } = load(context);
  if (actor) throw redirect("/account");
  const open = await isRegistrationOpen(server);
  return {
    open,
    formToken: open ? await issueFormToken(server, FORM) : null,
    turnstileSiteKey: server.config.turnstile.secretKey ? server.config.turnstile.siteKey : null,
    hours: REGISTRATION_POLICY.ttl / HOUR,
  };
}

type Result =
  | { sent: true }
  | { sent: false; message: string; fields: Record<string, string>; values?: Values };
type Values = { accountType: string; name: string; email: string };

export async function action({ context, request }: Route.ActionArgs) {
  const { server, actor } = load(context);
  if (actor) throw redirect("/account");
  if (!(await isRegistrationOpen(server))) {
    return data<Result>(
      { sent: false, message: "Registration is closed right now.", fields: {} },
      { status: 403 },
    );
  }
  if (!(await checkRateLimit(server, "RL_AUTH", "register"))) {
    return data<Result>(
      {
        sent: false,
        message: "Too many attempts from this network. Please wait a minute and try again.",
        fields: {},
      },
      { status: 429 },
    );
  }
  const form = await request.formData();
  const values: Values = {
    accountType: formString(form, "accountType"),
    name: formString(form, "name"),
    email: formString(form, "email"),
  };

  // Bots: a filled honeypot or an impossibly fast submission gets the normal answer, nothing else.
  if (formString(form, "nickname").trim() !== "") {
    await recordSecurityEvent(server, {
      type: "spam.detected",
      severity: "info",
      details: { form: FORM, signal: "honeypot" },
    });
    return data<Result>({ sent: true });
  }
  const token = await verifyFormToken(server, FORM, formString(form, "formToken"));
  if (!token.ok) {
    if (token.reason === "too_fast") return data<Result>({ sent: true });
    return data<Result>(
      {
        sent: false,
        message: "This form has expired. Please reload the page and try again.",
        fields: {},
        values,
      },
      { status: 400 },
    );
  }
  const turnstile = await verifyTurnstile(
    server,
    formString(form, "cf-turnstile-response") || null,
    FORM,
  );
  if (!turnstile.ok) {
    return data<Result>(
      {
        sent: false,
        message: "We couldn't verify this request. Please complete the check and try again.",
        fields: {},
        values,
      },
      { status: 400 },
    );
  }

  const parsed = registrationSchema.safeParse({ ...values, consent: formString(form, "consent") });
  if (!parsed.success) {
    return data<Result>(
      {
        sent: false,
        message: "Please check the highlighted fields.",
        fields: fieldErrors(parsed.error),
        values,
      },
      { status: 400 },
    );
  }
  // Identical answer — content and timing — whether or not the address already has an account.
  startRegistrationInBackground(server, parsed.data);
  return data<Result>({ sent: true });
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Create an account — VORA" }, { name: "robots", content: "noindex" }];
}

export default function Register({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>() as Result | undefined;
  const busy = useNavigation().state === "submitting";
  const nonce = useRouteLoaderData<typeof rootLoader>("root")?.nonce;

  if (result?.sent) {
    return (
      <div className="v-auth__card">
        <h1 className="v-heading-l">Check your email</h1>
        <Notice tone="success" label="Sent">
          If this address can be registered, we've sent a link to confirm it and choose your
          password. The link expires in {loaderData.hours} hours.
        </Notice>
        <p className="v-body v-secondary">
          Already have an account? We've emailed you a reminder to sign in instead.
        </p>
        <p className="v-auth__links">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  if (!loaderData.open) {
    return (
      <div className="v-auth__card">
        <h1 className="v-heading-l">Create an account</h1>
        <p className="v-body v-secondary">
          New accounts aren't open right now. If you're working with VORA, your contact can invite
          you.
        </p>
        <p className="v-auth__links">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  const failure = result && !result.sent ? result : null;
  const fields = failure?.fields ?? {};
  const values = failure?.values;
  return (
    <div className="v-auth__card">
      <h1 className="v-heading-l">Create an account</h1>
      <p className="v-body v-secondary">Owner, Admin and Staff accounts are by invitation only.</p>
      {failure ? <ErrorSummary message={failure.message} fields={failure.fields} /> : null}
      <FormScope prefix="register">
        <Form method="post" className="v-form v-form--tight" noValidate>
          <input type="hidden" name="formToken" value={loaderData.formToken ?? ""} />
          <div className="v-honeypot" aria-hidden="true">
            <label>
              Leave this field empty
              <input type="text" name="nickname" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <ChoiceGroup
            type="radio"
            name="accountType"
            label="Account type"
            required
            options={ACCOUNT_TYPES}
            defaultValues={values?.accountType ? [values.accountType] : []}
            error={fields.accountType}
          />
          <TextField
            name="name"
            label="Your name"
            autoComplete="name"
            required
            maxLength={120}
            defaultValue={values?.name}
            error={fields.name}
          />
          <TextField
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={values?.email}
            error={fields.email}
          />
          <Checkbox
            name="consent"
            required
            error={fields.consent}
            label={
              <>
                I've read the{" "}
                <Link className="v-link" to="/privacy">
                  Privacy Policy
                </Link>{" "}
                and the{" "}
                <Link className="v-link" to="/terms">
                  Terms &amp; Conditions
                </Link>
                .
              </>
            }
          />
          {loaderData.turnstileSiteKey ? (
            <>
              <div
                className="cf-turnstile"
                data-sitekey={loaderData.turnstileSiteKey}
                data-action="register"
              />
              <script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                async
                defer
                nonce={nonce}
              />
            </>
          ) : null}
          <Button busy={busy}>{busy ? "Sending…" : "Continue"}</Button>
        </Form>
      </FormScope>
      <p className="v-body-s v-secondary">
        Next, we'll email you a link to confirm your address and choose a password.
      </p>
      <p className="v-auth__links">
        <Link to="/login">Already have an account? Sign in</Link>
      </p>
    </div>
  );
}
