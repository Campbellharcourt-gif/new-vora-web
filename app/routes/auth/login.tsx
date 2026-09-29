import { loginSchema } from "@shared/validation/auth";
import { fieldErrors } from "@shared/validation/common";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import { homePathFor, type LoginResult, signIn } from "~/.server/auth/login";
import { formString, load, safeNext } from "~/.server/guards";
import { isAppError } from "~/.server/lib/errors";
import { Button, ErrorSummary, Notice, TextField } from "~/components/ui/forms";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/login";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { actor, pending, server } = load(context);
  const url = new URL(request.url);
  if (actor) throw redirect(safeNext(url.searchParams.get("next"), defaultHome(actor.permissions)));
  if (pending)
    throw redirect(
      `/login/verify?next=${encodeURIComponent(safeNext(url.searchParams.get("next")))}`,
    );
  return {
    turnstileSiteKey: server.config.turnstile.secretKey ? server.config.turnstile.siteKey : null,
  };
}

function defaultHome(permissions: ReadonlySet<string>): string {
  if (permissions.has("admin.access")) return "/admin";
  if (permissions.has("client_portal.access")) return "/client";
  if (permissions.has("member_portal.access")) return "/member";
  return "/account";
}

const MESSAGES = {
  invalid_credentials: "Email or password is incorrect.",
  locked:
    "Too many attempts. Sign-in is paused for 15 minutes — try again later or reset your password.",
  challenge_required: "Please complete the security check and try again.",
  rate_limited: "Too many attempts from this network. Please wait a minute and try again.",
  account_unavailable:
    "This account can't sign in right now. Contact VORA if you think this is a mistake.",
} as const;

type LoginFailure = { message: string; fields: Record<string, string>; challenge: boolean };

export async function action({ context, request }: Route.ActionArgs) {
  const { server } = load(context);
  const form = await request.formData();
  const next = safeNext(formString(form, "next"), "");
  const parsed = loginSchema.safeParse({
    email: formString(form, "email"),
    password: formString(form, "password"),
  });
  if (!parsed.success) {
    return data<LoginFailure>(
      {
        message: "Enter your email and password.",
        fields: fieldErrors(parsed.error),
        challenge: false,
      },
      { status: 400 },
    );
  }
  let result: LoginResult;
  try {
    result = await signIn(server, {
      ...parsed.data,
      turnstileToken: formString(form, "cf-turnstile-response") || null,
    });
  } catch (error) {
    // Password hashing unavailable (native Argon2id queue full or failing): answer 503 with a clear
    // message on the form instead of the generic error page. Nothing was recorded against the
    // account. Any other error is re-thrown exactly as before.
    if (isAppError(error) && error.code === "service_unavailable") {
      return data<LoginFailure>(
        { message: error.publicMessage, fields: {}, challenge: false },
        { status: 503 },
      );
    }
    throw error;
  }
  if (result.kind === "error") {
    const status = result.code === "rate_limited" ? 429 : result.code === "locked" ? 423 : 401;
    return data<LoginFailure>(
      { message: MESSAGES[result.code], fields: {}, challenge: Boolean(result.challengeRequired) },
      { status },
    );
  }
  const headers = { "Set-Cookie": result.session.cookie };
  if (result.kind === "mfa_required") {
    const query = new URLSearchParams({
      ...(next ? { next } : {}),
      ...(result.codeSent ? {} : { sent: "0" }),
    });
    return redirect(`/login/verify?${query}`, { headers });
  }
  return redirect(next || (await homePathFor(server, result.userId)), { headers });
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Sign in — VORA" }, { name: "robots", content: "noindex" }];
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>() as LoginFailure | undefined;
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const nonce = useRouteLoaderData<typeof rootLoader>("root")?.nonce;
  const busy = navigation.state === "submitting";
  const showChallenge = Boolean(result?.challenge && loaderData.turnstileSiteKey);

  return (
    <div className="v-auth__card">
      <h1 className="v-heading-l">Sign in</h1>
      {params.get("reset") === "1" ? (
        <Notice tone="success">Your password was changed. Sign in with the new one.</Notice>
      ) : null}
      {params.get("signedout") === "1" ? <Notice>You've been signed out.</Notice> : null}
      {result ? <ErrorSummary message={result.message} fields={result.fields} /> : null}
      <Form method="post" className="v-form v-form--tight">
        <input type="hidden" name="next" value={params.get("next") ?? ""} />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          required
          error={result?.fields?.email}
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          error={result?.fields?.password}
        />
        {showChallenge ? (
          <>
            <div
              className="cf-turnstile"
              data-sitekey={loaderData.turnstileSiteKey ?? ""}
              data-action="login"
            />
            <script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              async
              defer
              nonce={nonce}
            />
          </>
        ) : null}
        <Button busy={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </Form>
      <p className="v-auth__links">
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
    </div>
  );
}
