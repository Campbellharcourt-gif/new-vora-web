import type { ServerContext } from "../context";
import { AppError } from "../lib/errors";
import { describeError } from "../observability/logger";
import {
  burnPasswordCheck,
  hashPassword,
  isPolicyHash,
  TIMING_DUMMY_HASH,
  verifyPassword,
} from "./password";

/**
 * Where password hashing runs (CP-3 · Cloudflare Free).
 *
 * - `durable_object` — deployed environments bind PASSWORD_HASHER (wrangler.jsonc), and every
 *   Argon2id computation runs in the PasswordHasher Durable Object (password-hasher.ts), so the
 *   Worker request itself stays within the Free plan's 10 ms CPU limit.
 * - `in_process` — no binding (unit tests, scripts): the same functions run in this isolate.
 *
 * Either way the algorithm and parameters are those of password.ts; nothing is weakened. When the
 * Durable Object cannot be reached, or returns anything but a policy-strength hash / a boolean,
 * the operation FAILS CLOSED with a 503: no in-process fallback (on Free that would exceed the
 * CPU limit), no weaker hash, and — because it throws before any attempt is recorded — no
 * failed-sign-in count against the account.
 */
export interface PasswordHashing {
  readonly mode: "durable_object" | "in_process";
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
  /** The same work as a real verify, for unknown emails, so timing never reveals an account. */
  burn(password: string): Promise<void>;
}

const IN_PROCESS: PasswordHashing = {
  mode: "in_process",
  hash: hashPassword,
  verify: verifyPassword,
  burn: burnPasswordCheck,
};

export const PASSWORD_HASHING_UNAVAILABLE =
  "Signing in and changing passwords are temporarily unavailable. Please try again in a few minutes.";

export function passwordHashing(ctx: Pick<ServerContext, "env" | "log">): PasswordHashing {
  const namespace = ctx.env.PASSWORD_HASHER;
  if (!namespace) return IN_PROCESS;

  // A fresh object for every operation: created near the calling Worker, with no shared queue
  // between concurrent sign-ins and no state to keep.
  const hasher = () => namespace.get(namespace.newUniqueId());

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

  const verify = async (password: string, encoded: string): Promise<boolean> => {
    let ok: unknown;
    try {
      ok = await hasher().verify(password, encoded);
    } catch (error) {
      throw unavailable("verify", "durable_object_error", error);
    }
    if (typeof ok !== "boolean") throw unavailable("verify", "unexpected_result");
    return ok;
  };

  return {
    mode: "durable_object",
    async hash(password) {
      let encoded: unknown;
      try {
        encoded = await hasher().hash(password);
      } catch (error) {
        throw unavailable("hash", "durable_object_error", error);
      }
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
