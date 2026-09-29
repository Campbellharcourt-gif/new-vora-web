import { redirect } from "react-router";
import { clearSessionCookie, revokeSession } from "~/.server/auth/sessions";
import { load } from "~/.server/guards";
import type { Route } from "./+types/logout";

/** GET never signs anyone out (no logout-by-image-tag); only a same-origin POST does. */
export function loader() {
  throw redirect("/");
}

export async function action({ context }: Route.ActionArgs) {
  const { server, actor, pending } = load(context);
  const sessionId = actor?.session.id ?? pending?.sessionId;
  if (sessionId) await revokeSession(server, sessionId, "signed_out");
  return redirect("/login?signedout=1", { headers: { "Set-Cookie": clearSessionCookie(server) } });
}
