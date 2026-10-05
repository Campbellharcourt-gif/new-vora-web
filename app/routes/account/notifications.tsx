import { Form, Link, useNavigation } from "react-router";
import { formString, load, requireActor } from "~/.server/guards";
import { listNotifications, markNotificationsRead } from "~/.server/services/notifications";
import { Button } from "~/components/ui/forms";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/notifications";

/** In-app notifications for whoever is signed in (scoped to them in SQL). */
export async function loader({ context, request }: Route.LoaderArgs) {
  const actor = requireActor(context, request);
  return { items: await listNotifications(load(context).server, actor, { limit: 100 }) };
}

export async function action({ context, request }: Route.ActionArgs) {
  const actor = requireActor(context, request);
  const form = await request.formData();
  const id = formString(form, "id");
  await markNotificationsRead(load(context).server, actor, id ? [id] : "all");
  return { ok: true };
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "Notifications — Account — VORA" }];
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const busy = useNavigation().state === "submitting";
  const unread = loaderData.items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeading
        eyebrow="Account"
        title="Notifications"
        actions={
          unread > 0 ? (
            <Form method="post">
              <Button variant="secondary" size="s" busy={busy}>
                Mark all as read
              </Button>
            </Form>
          ) : null
        }
      />
      <Panel flush>
        {loaderData.items.length === 0 ? (
          <div className="v-panel__body">
            <p className="v-body">Nothing yet. Updates about your work and account appear here.</p>
          </div>
        ) : (
          <ul className="v-list">
            {loaderData.items.map((n) => (
              <li key={n.id} data-unread={n.readAt ? undefined : ""}>
                <span>
                  {n.readAt ? null : <span className="v-sr">Unread: </span>}
                  {n.link ? (
                    <Link to={n.link} className={n.readAt ? undefined : "v-strong"}>
                      {n.title}
                    </Link>
                  ) : (
                    <span className={n.readAt ? undefined : "v-strong"}>{n.title}</span>
                  )}
                  {n.body ? <span className="v-secondary"> · {n.body}</span> : null}
                  <span className="v-secondary v-data"> · {formatDateTime(n.createdAt)}</span>
                </span>
                {n.readAt ? null : (
                  <Form method="post">
                    <input type="hidden" name="id" value={n.id} />
                    <Button variant="quiet" size="s" busy={busy}>
                      Mark read<span className="v-sr"> — {n.title}</span>
                    </Button>
                  </Form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
