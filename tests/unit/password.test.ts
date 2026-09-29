import { describe, expect, it, vi } from "vitest";
import {
  ARGON2_PARAMS,
  breachCount,
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  parseHash,
  verifyPassword,
} from "~/.server/auth/password";
import { sha256Hex } from "~/.server/lib/crypto";
import { toHex, utf8 } from "~/.server/lib/encoding";

describe("Argon2id password hashing", () => {
  it("stores a PHC string with the policy parameters and a random salt", async () => {
    const a = await hashPassword("a long enough passphrase");
    const b = await hashPassword("a long enough passphrase");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b); // unique salt per hash
    const parsed = parseHash(a);
    expect(parsed).toMatchObject(ARGON2_PARAMS);
    expect(parsed?.salt.length).toBe(16);
    expect(parsed?.hash.length).toBe(32);
  });

  it("verifies the right password and rejects wrong ones", async () => {
    const hash = await hashPassword("north-facing-window-7");
    expect(await verifyPassword("north-facing-window-7", hash)).toBe(true);
    expect(await verifyPassword("north-facing-window-8", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("normalises Unicode (NFKC) so the same visible password always verifies", async () => {
    const hash = await hashPassword("Ｐassword-ｗith-fullwidth");
    expect(await verifyPassword("Password-with-fullwidth", hash)).toBe(true);
  });

  it("refuses malformed and absurd-parameter hashes without computing them", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "$argon2i$v=19$m=19456,t=2,p=1$AAAA$AAAA")).toBe(false);
    const started = Date.now();
    const absurd =
      "$argon2id$v=19$m=4194304,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g";
    expect(await verifyPassword("x", absurd)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("flags weaker stored parameters for rehash on next sign-in", async () => {
    const current = await hashPassword("some password value");
    expect(needsRehash(current)).toBe(false);
    const weaker = current.replace("m=19456,t=2", "m=4096,t=1");
    expect(needsRehash(weaker)).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });
});

describe("password policy", () => {
  it("enforces length bounds", () => {
    expect(checkPasswordPolicy("short")).toMatch(/at least 12/);
    expect(checkPasswordPolicy("x".repeat(129))).toMatch(/at most 128/);
    expect(checkPasswordPolicy("a sensible passphrase")).toBeNull();
  });

  it("blocks common passwords, repeats, email, name and the brand", () => {
    expect(checkPasswordPolicy("Password1234")).toMatch(/too common/);
    expect(checkPasswordPolicy("zzzzzzzzzzzzzz")).toMatch(/single character/);
    expect(checkPasswordPolicy("strive-rules-2026", { email: "strive@vora.test" })).toMatch(
      /email/,
    );
    expect(checkPasswordPolicy("i-am-alexandra-ok", { name: "Alexandra Smith" })).toMatch(/name/);
    expect(checkPasswordPolicy("my-vora-password")).toMatch(/VORA/);
  });

  it("does not impose composition rules (NIST 800-63B)", () => {
    expect(checkPasswordPolicy("all lower case words here")).toBeNull();
  });
});

describe("breach check (HIBP k-anonymity)", () => {
  async function suffixFor(password: string) {
    const digest = toHex(await crypto.subtle.digest("SHA-1", utf8(password))).toUpperCase();
    return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
  }

  it("sends only the 5-character prefix and reports the breach count", async () => {
    const { prefix, suffix } = await suffixFor("hunter2hunter2");
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(`0000000000000000000000000000000000A:3\r\n${suffix}:42\r\n`),
    );
    const count = await breachCount("hunter2hunter2", fetchImpl as unknown as typeof fetch);
    expect(count).toBe(42);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(String(url)).not.toContain(suffix);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["Add-Padding"]).toBe("true");
  });

  it("returns 0 when the suffix is absent", async () => {
    const fetchImpl = async () => new Response("ABCDEF0123456789ABCDEF0123456789ABC:1\n");
    expect(await breachCount("unique-passphrase-xyz", fetchImpl as unknown as typeof fetch)).toBe(
      0,
    );
  });

  it("fails open (null) on HTTP errors, network errors and timeouts", async () => {
    const httpError = async () => new Response("nope", { status: 503 });
    expect(await breachCount("pw-value-123456", httpError as unknown as typeof fetch)).toBeNull();
    const networkError = async () => {
      throw new TypeError("network down");
    };
    expect(
      await breachCount("pw-value-123456", networkError as unknown as typeof fetch),
    ).toBeNull();
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const started = Date.now();
    expect(await breachCount("pw-value-123456", hang as unknown as typeof fetch, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("never sends the password or its full hash", async () => {
    const password = "correct-horse-battery-staple-42";
    const full = toHex(await crypto.subtle.digest("SHA-1", utf8(password))).toUpperCase();
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      return new Response("");
    };
    await breachCount(password, fetchImpl as unknown as typeof fetch);
    expect(seen.join()).not.toContain(password);
    expect(seen.join()).not.toContain(full);
    expect(seen.join()).not.toContain(await sha256Hex(password));
  });
});
