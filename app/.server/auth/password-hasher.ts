import { DurableObject } from "cloudflare:workers";
import { hashPassword, verifyPassword } from "./password";

/**
 * CP-3 · Cloudflare Free. Argon2id costs ~200–300 ms of CPU per hash, and a Worker on the Free
 * plan may use 10 ms of CPU per request. A Durable Object invocation has its own CPU allowance
 * (30 s by default, per the Durable Objects limits page), and Cloudflare's Workers limits page
 * recommends moving expensive computation to a Durable Object. So the Worker sends the
 * password-hashing step here over RPC and waits for the result; the waiting is I/O, not Worker
 * CPU. The hash itself is unchanged: the same Argon2id code and parameters (password.ts).
 *
 * Stateless: it never touches storage, never logs, and holds nothing between calls. Durable
 * Objects are only reachable through the PASSWORD_HASHER binding of this Worker — there is no
 * public route to them. The caller (password-hashing.ts) re-checks every hash it gets back.
 *
 * Whether the Free plan really grants a Durable Object more than 10 ms of CPU is NOT VERIFIED
 * locally (workerd enforces no CPU limits): docs/CLOUDFLARE-FREE-COMPATIBILITY.md has the check.
 */

/** Longest password input accepted, in characters (sign-in allows 512; new passwords 128). */
export const MAX_PASSWORD_INPUT = 1024;
/** Longest stored-hash input accepted by verify() (a policy PHC string is about 100 characters). */
export const MAX_ENCODED_INPUT = 256;

function checked(password: unknown): string {
  // The error never includes the value.
  if (typeof password !== "string" || password.length > MAX_PASSWORD_INPUT) {
    throw new TypeError("PasswordHasher: invalid password input");
  }
  return password;
}

export class PasswordHasher extends DurableObject {
  /** A new policy-strength Argon2id hash (PHC string) with a fresh random salt. */
  async hash(password: string): Promise<string> {
    return hashPassword(checked(password));
  }

  /** True when the password matches the stored hash. Malformed hashes verify as false. */
  async verify(password: string, encoded: string): Promise<boolean> {
    const input = checked(password);
    if (typeof encoded !== "string" || encoded.length > MAX_ENCODED_INPUT) return false;
    return verifyPassword(input, encoded);
  }
}
