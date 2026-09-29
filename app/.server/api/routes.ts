import { Hono } from "hono";
import { z } from "zod";
import { askVora } from "../ai/assistant";
import { getSecurityOverview, revokeOtherSessions, revokeOwnSession } from "../auth/account";
import { authorize } from "../auth/rbac";
import type { KernelEnv } from "../kernel/types";
import { errors } from "../lib/errors";
import { submitEnquiry } from "../services/enquiries";
import { checkDatabase, checkLive, publicHealth, systemHealth } from "../services/health";
import { apiError, readJson } from "./respond";

/**
 * JSON API. Every handler: validate input → call a service (which authorises) → map the result.
 * Errors always use the shared envelope via `apiError`.
 */
export function createApi() {
  const api = new Hono<KernelEnv>();

  // --- Health (public, minimal) -----------------------------------------------------------
  api.get("/health", (c) => c.json({ status: "ok" }, 200, { "Cache-Control": "no-store" }));

  // Railway's deploy health check: process + database + migrations only (never R2 or email).
  api.get("/health/live", async (c) => {
    const live = await checkLive(c.get("server"));
    return c.json(
      {
        status: live.ok ? "live" : "unavailable",
        database: live.database,
        migrations: live.migrations,
        foreignKeys: live.foreignKeys,
      },
      live.ok ? 200 : 503,
      { "Cache-Control": "no-store" },
    );
  });

  api.get("/health/ready", async (c) => {
    const db = await checkDatabase(c.get("server"));
    const ok = db.state !== "down";
    return c.json({ status: ok ? "ready" : "unavailable" }, ok ? 200 : 503, {
      "Cache-Control": "no-store",
    });
  });

  api.get("/v1/status", async (c) => {
    try {
      const health = await systemHealth(c.get("server"));
      return c.json(publicHealth(health), 200, { "Cache-Control": "public, max-age=30" });
    } catch (error) {
      return apiError(c, error);
    }
  });

  // --- System status (detailed, permissioned) ---------------------------------------------
  api.get("/v1/system/status", async (c) => {
    try {
      await authorize(c.get("server"), c.get("actor"), "system.status");
      return c.json(await systemHealth(c.get("server")));
    } catch (error) {
      return apiError(c, error);
    }
  });

  // --- Enquiries (public) -----------------------------------------------------------------
  const enquiryBody = z.object({
    fields: z.record(z.string(), z.unknown()),
    formToken: z.string().max(200),
    honeypot: z.string().max(200).optional().nullable(),
    turnstileToken: z.string().max(2048).optional().nullable(),
  });

  api.post("/v1/enquiries", async (c) => {
    try {
      const parsed = enquiryBody.safeParse(await readJson(c, 32 * 1024));
      if (!parsed.success)
        throw errors.validation({ _form: "The request was not in the expected format." });
      const outcome = await submitEnquiry(c.get("server"), parsed.data);
      return c.json(
        outcome.kind === "accepted"
          ? { status: "received", reference: outcome.reference }
          : { status: "received" },
        201,
      );
    } catch (error) {
      return apiError(c, error);
    }
  });

  // --- Ask VORA (public AI assistant; off unless the flag, setting and key are all set) ----
  const askBody = z.object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(8000),
        }),
      )
      .min(1)
      .max(100),
  });

  api.post("/v1/ai/ask", async (c) => {
    try {
      const parsed = askBody.safeParse(await readJson(c, 64 * 1024));
      if (!parsed.success)
        throw errors.validation({ _form: "The request was not in the expected format." });
      const answer = await askVora(c.get("server"), c.get("actor"), parsed.data.messages);
      return c.json(answer, 200, { "Cache-Control": "no-store" });
    } catch (error) {
      return apiError(c, error);
    }
  });

  // --- Account: own sessions --------------------------------------------------------------
  api.get("/v1/account/sessions", async (c) => {
    try {
      const actor = c.get("actor");
      if (!actor) throw errors.unauthenticated();
      const overview = await getSecurityOverview(c.get("server"), actor);
      return c.json({
        sessions: overview.sessions.map((s) => ({
          id: s.id,
          current: s.current,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          location: [s.city, s.country].filter(Boolean).join(", ") || null,
          userAgent: s.userAgent,
        })),
      });
    } catch (error) {
      return apiError(c, error);
    }
  });

  api.delete("/v1/account/sessions/:id", async (c) => {
    try {
      const actor = c.get("actor");
      if (!actor) throw errors.unauthenticated();
      await revokeOwnSession(c.get("server"), actor, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return apiError(c, error);
    }
  });

  api.post("/v1/account/sessions/revoke-others", async (c) => {
    try {
      const actor = c.get("actor");
      if (!actor) throw errors.unauthenticated();
      const count = await revokeOtherSessions(c.get("server"), actor);
      return c.json({ revoked: count });
    } catch (error) {
      return apiError(c, error);
    }
  });

  // --- Development mailbox (never registered in staging/production) -----------------------
  api.get("/dev/mailbox", async (c) => {
    const server = c.get("server");
    if (server.config.isProductionLike || !c.env.DEV_MAILBOX) return apiError(c, errors.notFound());
    const to = c.req.query("to")?.toLowerCase();
    const list = await c.env.DEV_MAILBOX.list({ prefix: "mail:" });
    const messages = [];
    for (const key of list.keys.slice(-50)) {
      const raw = await c.env.DEV_MAILBOX.get(key.name);
      if (!raw) continue;
      const message = JSON.parse(raw) as {
        to: string;
        subject: string;
        text: string;
        capturedAt: number;
      };
      if (!to || message.to === to)
        messages.push({
          to: message.to,
          subject: message.subject,
          text: message.text,
          capturedAt: message.capturedAt,
        });
    }
    messages.sort((a, b) => b.capturedAt - a.capturedAt);
    return c.json({ messages });
  });

  return api;
}
