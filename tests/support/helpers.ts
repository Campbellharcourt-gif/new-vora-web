import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { hashPassword } from "~/.server/auth/password";
import { loadUserAccess } from "~/.server/auth/rbac";
import { createSession, elevateSession, resolveSession } from "~/.server/auth/sessions";
import type { Actor } from "~/.server/auth/types";
import type { WorkerEnv } from "~/.server/config/env";
import { createServerContext, type ServerContext } from "~/.server/context";
import { createDb, schema } from "~/.server/db/client";
import { capturedEmails } from "~/.server/email/transport";
import { newId } from "~/.server/lib/ids";
import type { Clock } from "~/.server/lib/time";
import { clearFlagCache } from "~/.server/services/flags";
import { clearSettingsCache } from "~/.server/services/settings";
import { kernel } from "./test-worker";

export const ORIGIN = "http://localhost:5173";
export const SESSION_COOKIE = "vora_session";
export const testEnv = env as unknown as WorkerEnv;
export const db = createDb(testEnv.DB);

/** A clock tests can move forward. */
export function manualClock(
  start = Date.now(),
): Clock & { advance(ms: number): void; set(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    set: (ms: number) => {
      now = ms;
    },
  };
}

let ipSeq = 0;
/** A fresh client IP per scenario so per-IP limits and IP-hash signals never leak across tests. */
export function uniqueIp(): string {
  ipSeq += 1;
  return `198.18.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

let emailSeq = 0;
export function uniqueEmail(prefix = "user"): string {
  emailSeq += 1;
  return `${prefix}-${emailSeq}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export interface CtxOptions {
  ip?: string;
  userAgent?: string;
  country?: string;
  asn?: number;
  clock?: Clock;
  url?: string;
  env?: WorkerEnv;
}

export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

/** Builds a real ServerContext; background work is collected so tests can await it. */
export function makeCtx(options: CtxOptions = {}): ServerContext & { flush(): Promise<void> } {
  const pending: Promise<unknown>[] = [];
  // Location and network arrive as Cloudflare headers on Railway (CF-IPCountry and the ASN
  // Transform Rule header), where Workers had `request.cf` (Railway migration R5).
  const request = new Request(options.url ?? `${ORIGIN}/`, {
    headers: {
      "cf-connecting-ip": options.ip ?? "203.0.113.10",
      "user-agent": options.userAgent ?? DEFAULT_UA,
      ...(options.country ? { "cf-ipcountry": options.country } : {}),
      ...(options.asn !== undefined ? { "x-vora-asn": String(options.asn) } : {}),
    },
  });
  const ctx = createServerContext({
    env: options.env ?? testEnv,
    request,
    requestId: crypto.randomUUID(),
    waitUntil: (p) => {
      pending.push(p);
    },
    ...(options.clock ? { clock: options.clock } : {}),
  });
  return Object.assign(ctx, {
    async flush() {
      while (pending.length) await Promise.allSettled(pending.splice(0));
    },
  });
}

const hashCache = new Map<string, Promise<string>>();
export const PASSWORD = "correct-horse-battery-staple-42";

export async function createUser(input: {
  email?: string;
  name?: string;
  roles?: string[];
  password?: string;
  status?: "active" | "suspended";
  mfaEnforced?: boolean;
}): Promise<{ id: string; email: string }> {
  const password = input.password ?? PASSWORD;
  let hash = hashCache.get(password);
  if (!hash) {
    hash = hashPassword(password);
    hashCache.set(password, hash);
  }
  const email = (input.email ?? uniqueEmail(input.roles?.[0] ?? "user")).toLowerCase();
  const now = Date.now();
  const id = newId("user", now);
  await db.insert(schema.users).values({
    id,
    email,
    emailVerifiedAt: now,
    name: input.name ?? "Test Person",
    passwordHash: await hash,
    status: input.status ?? "active",
    mfaEnforced: input.mfaEnforced ?? false,
    createdAt: now,
    updatedAt: now,
  });
  for (const key of input.roles ?? []) {
    const role = await db.select().from(schema.roles).where(eq(schema.roles.key, key)).get();
    if (!role) throw new Error(`Unknown role ${key}`);
    await db.insert(schema.userRoles).values({ userId: id, roleId: role.id, grantedAt: now });
  }
  return { id, email };
}

export function withCookie(token: string, url = `${ORIGIN}/`): Request {
  return new Request(url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

/** Creates a real full session row for a user (as a completed sign-in would). */
export async function signedInSession(
  userId: string,
  options: { mfaVerified?: boolean; ctx?: ServerContext } = {},
) {
  const ctx = options.ctx ?? makeCtx();
  const access = await loadUserAccess(db, userId);
  return createSession(ctx, {
    userId,
    authLevel: "full",
    authMethod: "test",
    privileged: access.privileged,
    mfaVerified: options.mfaVerified ?? true,
  });
}

/** Resolves an Actor through the real session path (optionally with a fresh step-up). */
export async function actorFor(userId: string, options: { elevated?: boolean } = {}) {
  const ctx = makeCtx();
  const session = await signedInSession(userId, { ctx });
  if (options.elevated) await elevateSession(ctx, session.sessionId);
  const resolved = await resolveSession(ctx, withCookie(session.token));
  if (resolved.kind !== "full") throw new Error(`No full session for ${userId}`);
  return Object.assign(resolved.actor as Actor, { token: session.token });
}

/** Calls the real kernel (headers, CSRF, sessions, API) and waits for background work. */
export async function call(
  path: string,
  init: RequestInit & { ip?: string; env?: WorkerEnv; token?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", init.ip ?? uniqueIp());
  if (init.token) headers.set("cookie", `${SESSION_COOKIE}=${init.token}`);
  const ctx = createExecutionContext();
  const { ip: _ip, env: envOverride, token: _token, ...rest } = init;
  const response = await kernel.fetch(
    new Request(`${ORIGIN}${path}`, { ...rest, headers }),
    envOverride ?? testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** Headers for a same-origin browser POST (passes the CSRF gate). */
export const SAME_ORIGIN = { origin: ORIGIN, "sec-fetch-site": "same-origin" } as const;

export async function mailboxFor(to: string): Promise<{ subject: string; text: string }[]> {
  const kv = testEnv.DEV_MAILBOX;
  if (!kv) throw new Error("DEV_MAILBOX binding missing in tests");
  const list = await kv.list({ prefix: "mail:" });
  const out: { subject: string; text: string; capturedAt: number }[] = [];
  for (const key of list.keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    const message = JSON.parse(raw) as {
      to: string;
      subject: string;
      text: string;
      capturedAt: number;
    };
    if (message.to === to.toLowerCase()) out.push(message);
  }
  return out.sort((a, b) => a.capturedAt - b.capturedAt);
}

/** Emails captured in this isolate for a recipient (newest last). */
export function sentTo(to: string) {
  return capturedEmails.filter((m) => m.to === to.toLowerCase());
}

export function codeFrom(text: string): string {
  const match = /\b(\d{6})\b/.exec(text);
  if (!match?.[1]) throw new Error("No 6-digit code in email");
  return match[1];
}

export function linkFrom(text: string, path: string): string {
  const match = new RegExp(`${ORIGIN}${path}/([A-Za-z0-9_-]{43})`).exec(text);
  if (!match?.[1]) throw new Error(`No ${path} link in email`);
  return match[1];
}

export function resetCaches(): void {
  clearSettingsCache();
  clearFlagCache();
}

export async function setFlag(
  key: string,
  enabled: boolean,
  rules: { roles?: string[]; environments?: string[] } | null = null,
): Promise<void> {
  await db
    .insert(schema.featureFlags)
    .values({ key, description: "test", enabled, rules, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.featureFlags.key, set: { enabled, rules } });
  resetCaches();
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(schema.siteSettings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.siteSettings.key, set: { value } });
  resetCaches();
}

/** The HIBP range API is external; integration tests pin the flag off and unit-test the check. */
export async function disableBreachCheck(): Promise<void> {
  await setFlag("auth.breach_check", false);
}

export { env, schema };
