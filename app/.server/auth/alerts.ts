import type { ServerContext } from "../context";
import { enqueueEmail } from "../email/outbox";
import { describeLocation, describeUserAgent } from "../lib/request-meta";

/** Security alert emails. They contain no secrets, so they go through the retried outbox. */
export async function sendNewSignInAlert(
  ctx: ServerContext,
  user: { id: string; email: string; name: string },
): Promise<void> {
  const when = new Date(ctx.clock.now()).toUTCString();
  await enqueueEmail(ctx, {
    template: "newSignIn",
    to: user.email,
    data: {
      name: user.name,
      when,
      device: describeUserAgent(ctx.meta.userAgent),
      location: describeLocation(ctx.meta),
      url: `${ctx.config.origin}/account/security`,
    },
    related: { type: "user", id: user.id },
  });
}

export async function sendSecurityNotice(
  ctx: ServerContext,
  user: { id: string; email: string; name: string },
  heading: string,
  message: string,
): Promise<void> {
  await enqueueEmail(ctx, {
    template: "securityNotice",
    to: user.email,
    data: { name: user.name, heading, message, url: `${ctx.config.origin}/account/security` },
    related: { type: "user", id: user.id },
  });
}
