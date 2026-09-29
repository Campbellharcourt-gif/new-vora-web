import type { AppConfig, WorkerEnv } from "../config/env";
import type { DevMailbox } from "../platform/types";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
}

export interface SendResult {
  id: string;
}

export class EmailSendError extends Error {
  readonly retryable: boolean;
  readonly providerStatus: number | null;

  constructor(
    message: string,
    options: { retryable: boolean; providerStatus?: number | null; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "EmailSendError";
    this.retryable = options.retryable;
    this.providerStatus = options.providerStatus ?? null;
  }
}

export interface EmailTransport {
  readonly name: "resend" | "capture" | "disabled";
  send(message: EmailMessage): Promise<SendResult>;
}

/** Resend REST API. The API key never leaves the server. */
export class ResendTransport implements EmailTransport {
  readonly name = "resend" as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          ...(message.tags ? { tags: message.tags } : {}),
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as {
        id?: string;
        name?: string;
        message?: string;
      } | null;
      if (!res.ok || !body?.id) {
        // 429 and 5xx are transient; 4xx (bad address, unverified domain, invalid key) are not.
        const retryable = res.status === 429 || res.status >= 500;
        throw new EmailSendError(`Resend ${res.status}: ${body?.name ?? "unknown_error"}`, {
          retryable,
          providerStatus: res.status,
        });
      }
      return { id: body.id };
    } catch (error) {
      if (error instanceof EmailSendError) throw error;
      throw new EmailSendError("Resend request failed or timed out", {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface CapturedEmail extends EmailMessage {
  id: string;
  capturedAt: number;
}

/** In-memory copy for tests running in the same isolate. */
export const capturedEmails: CapturedEmail[] = [];

/**
 * Development/test transport: records the message (dev mailbox + memory) instead of sending.
 * Config validation forbids it in staging and production.
 */
export class CaptureTransport implements EmailTransport {
  readonly name = "capture" as const;

  constructor(private readonly mailbox?: DevMailbox) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const id = `capture_${crypto.randomUUID()}`;
    const captured: CapturedEmail = { ...message, id, capturedAt: Date.now() };
    capturedEmails.push(captured);
    if (capturedEmails.length > 200) capturedEmails.shift();
    if (this.mailbox) {
      const key = `mail:${String(captured.capturedAt).padStart(15, "0")}:${id}`;
      await this.mailbox.put(key, JSON.stringify(captured), { expirationTtl: 86_400 });
    }
    return { id };
  }
}

export class DisabledTransport implements EmailTransport {
  readonly name = "disabled" as const;

  async send(): Promise<SendResult> {
    throw new EmailSendError("Email transport is disabled", { retryable: false });
  }
}

let override: EmailTransport | null = null;

/** Tests can inject a transport (e.g. a failing one) without touching configuration. */
export function setEmailTransportOverride(transport: EmailTransport | null): void {
  override = transport;
}

export function getEmailTransport(config: AppConfig, env: WorkerEnv): EmailTransport {
  if (override) return override;
  switch (config.email.transport) {
    case "resend":
      return new ResendTransport(config.email.resendApiKey as string, config.email.from);
    case "capture":
      return new CaptureTransport(env.DEV_MAILBOX);
    default:
      return new DisabledTransport();
  }
}
