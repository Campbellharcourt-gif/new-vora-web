import { redirect } from "react-router";
import { load, requireActor } from "~/.server/guards";
import { isAppError } from "~/.server/lib/errors";
import { exportAccountData } from "~/.server/services/privacy";
import type { Route } from "./+types/privacy-export";

/**
 * POST /account/privacy/export — the signed-in person's data as a JSON download. Resource route
 * (no UI): it needs a recent password confirmation; without one it sends them back to confirm.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const actor = requireActor(context, request);
  try {
    const data = await exportAccountData(load(context).server, actor);
    const body = JSON.stringify(data, null, 2);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="vora-account-data-${day}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (isAppError(error) && error.code === "validation_failed") {
      throw redirect("/account/privacy?confirm=export");
    }
    throw error;
  }
}

export function loader() {
  return redirect("/account/privacy");
}
