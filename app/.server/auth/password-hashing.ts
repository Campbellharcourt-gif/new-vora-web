import type { ServerContext } from "../context";
import { AppError } from "../lib/errors";
import { describeError } from "../observability/logger";
import { hashPassword, isPolicyHash, TIMING_DUMMY_HASH, verifyPassword } from "./password";

/**
 * Where password hashing runs (Railway migration R2, §5.1).
 *
 * Argon2id runs in this process through Node's native `crypto.argon2` (password.ts), on the libuv
 * threadpool, with the policy parameters unchanged. CP-3's Durable Object existed only to escape a
 * Workers Free CPU limit; it is gone, and so is its binding. What stays is the contract:
 *
 * - **Back-pressure.** At most `MAX_CONCURRENT_HASHES` computations at once (about 19 MiB each),
 *   with a short queue. A full queue or a wait longer than `QUEUE_TIMEOUT_MS` answers 503 before
 *   anything is recorded — exactly as a Durable Object failure did: no attempt is counted, no
 *   reset link or invitation is burned. The per-IP and per-account throttles run before hashing.
 * - **Fails closed.** Any error, any result that is not a policy-strength hash or a boolean, and
 *   any oversized input is a 503. There is no fallback and no weaker hash.
 * - **Timing parity.** Unknown emails verify against a fixed policy-strength dummy hash — one
 *   hash of work, exactly as for a real account.
 */
export interface PasswordHashing {
  readonly mode: "native";
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
  /** The same work as a real verify, for unknown emails, so timing never reveals an account. */
  burn(password: string): Promise<void>;
}

export const PASSWORD_HASHING_UNAVAILABLE =
  "Signing in and changing passwords are temporarily unavailable. Please try again in a few minutes.";

/** Longest password input accepted, in characters (sign-in allows 512; new passwords 128). */
export const MAX_PASSWORD_INPUT = 1024;
/** Longest stored-hash input accepted by verify() (a policy PHC string is about 100 characters). */
export const MAX_ENCODED_INPUT = 256;
/** Concurrent Argon2id computations (§5.1 rule 4). */
export const MAX_CONCURRENT_HASHES = 4;
/** Operations allowed to wait for a slot; beyond this the request is refused at once. */
export const MAX_QUEUED_HASHES = 32;
/** Longest wait for a slot before the operation is refused. */
export const QUEUE_TIMEOUT_MS = 10_000;

type Derivation = {
  hash: (password: string) => Promise<string>;
  verify: (password: string, encoded: string) => Promise<boolean>;
};

const NATIVE: Derivation = { hash: hashPassword, verify: verifyPassword };

class Slots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    readonly limit: number,
    readonly queueLimit: number,
    readonly timeoutMs: number,
  ) {}

  get inUse(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  /** Resolves with a release function, or rejects with a reason when no slot can be had. */
  acquire(): Promise<() => void> {
    const release = () => {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    };
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(release);
    }
    if (this.waiting.length >= this.queueLimit) return Promise.reject(new Error("queue_full"));
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve(release);
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error("queue_timeout"));
      }, this.timeoutMs);
      this.waiting.push(grant);
    });
  }
}

let slots = new Slots(MAX_CONCURRENT_HASHES, MAX_QUEUED_HASHES, QUEUE_TIMEOUT_MS);
let derivation: Derivation = NATIVE;

/** Current load, for tests and diagnostics. */
export function passwordHashingLoad(): { active: number; queued: number } {
  return { active: slots.inUse, queued: slots.queued };
}

/**
 * Tests only: replace the derivation (e.g. one that fails or hangs) and/or the limits. Called with
 * no arguments it restores the native implementation and the production limits.
 */
export function setPasswordHashingForTests(
  override?: Partial<Derivation> & { limit?: number; queueLimit?: number; timeoutMs?: number },
): void {
  derivation = { ...NATIVE, ...(override ?? {}) };
  slots = new Slots(
    override?.limit ?? MAX_CONCURRENT_HASHES,
    override?.queueLimit ?? MAX_QUEUED_HASHES,
    override?.timeoutMs ?? QUEUE_TIMEOUT_MS,
  );
}

export function passwordHashing(ctx: Pick<ServerContext, "log">): PasswordHashing {
  const unavailable = (operation: "hash" | "verify", reason: string, error?: unknown) => {
    // Never logs the password or the stored hash — only what failed.
    ctx.log.error("password_hashing_unavailable", {
      operation,
      reason,
      ...(error === undefined ? {} : describeError(error)),
    });
    return new AppError("service_unavailable", {
      message: PASSWORD_HASHING_UNAVAILABLE,
      internal: { passwordHashing: operation, reason },
    });
  };

  const run = async <T>(operation: "hash" | "verify", work: () => Promise<T>): Promise<T> => {
    let release: () => void;
    try {
      release = await slots.acquire();
    } catch (error) {
      throw unavailable(operation, error instanceof Error ? error.message : "no_slot");
    }
    try {
      return await work();
    } catch (error) {
      throw unavailable(operation, "argon2_error", error);
    } finally {
      release();
    }
  };

  const checkedPassword = (operation: "hash" | "verify", password: unknown): string => {
    // Refused before any work; the error never includes the value.
    if (typeof password !== "string" || password.length > MAX_PASSWORD_INPUT) {
      throw unavailable(operation, "invalid_input");
    }
    return password;
  };

  const verify = async (password: string, encoded: string): Promise<boolean> => {
    const input = checkedPassword("verify", password);
    if (typeof encoded !== "string" || encoded.length > MAX_ENCODED_INPUT) return false;
    const ok: unknown = await run("verify", () => derivation.verify(input, encoded));
    if (typeof ok !== "boolean") throw unavailable("verify", "unexpected_result");
    return ok;
  };

  return {
    mode: "native",
    async hash(password) {
      const input = checkedPassword("hash", password);
      const encoded: unknown = await run("hash", () => derivation.hash(input));
      // Only a hash exactly as strong as the policy is ever stored.
      if (typeof encoded !== "string" || !isPolicyHash(encoded)) {
        throw unavailable("hash", "not_a_policy_hash");
      }
      return encoded;
    },
    verify,
    async burn(password) {
      await verify(password, TIMING_DUMMY_HASH);
    },
  };
}
