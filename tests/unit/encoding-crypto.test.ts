import { describe, expect, it } from "vitest";
import {
  hmacHex,
  hmacMatches,
  randomBytes,
  randomCrockford,
  randomDigits,
  randomInt,
  randomToken,
  sha256Hex,
  timingSafeEqual,
} from "~/.server/lib/crypto";
import {
  fromBase64Url,
  fromHex,
  normaliseCrockford,
  toBase64Url,
  toCrockford,
  toHex,
  utf8,
} from "~/.server/lib/encoding";
import { isId, newId, ulid } from "~/.server/lib/ids";

describe("encoding", () => {
  it("round-trips hex and base64url for every length 0–64", () => {
    for (let length = 0; length <= 64; length++) {
      const bytes = randomBytes(length);
      expect(fromHex(toHex(bytes))).toEqual(bytes);
      const b64 = toBase64Url(bytes);
      expect(b64).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(b64)).toEqual(bytes);
    }
  });

  it("rejects malformed hex and base64url instead of silently decoding", () => {
    expect(() => fromHex("abc")).toThrow();
    expect(() => fromHex("zz")).toThrow();
    expect(() => fromBase64Url("abc+def")).toThrow();
    expect(() => fromBase64Url("abc=")).toThrow();
  });

  it("encodes Crockford base32 with the standard alphabet", () => {
    // 0xFF 0xFF → 11111 11111 11111 1(0000) → "ZZZG"
    expect(toCrockford(new Uint8Array([0xff, 0xff]))).toBe("ZZZG");
    expect(toCrockford(new Uint8Array([0]))).toBe("00");
  });

  it("normalises user-typed Crockford codes (case, look-alikes, separators)", () => {
    expect(normaliseCrockford("abcde-12345")).toBe("ABCDE12345");
    expect(normaliseCrockford("o1l1i")).toBe("01111");
    expect(normaliseCrockford(" ab cd\te ")).toBe("ABCDE");
    expect(normaliseCrockford("u!@#")).toBe(""); // U is not in the alphabet
  });
});

describe("randomness", () => {
  it("produces 256-bit URL-safe tokens that do not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const token = randomToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(2000);
  });

  it("randomInt stays in range and covers every value (no modulo gaps)", () => {
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 5000; i++) {
      const n = randomInt(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
      counts[n] = (counts[n] ?? 0) + 1;
    }
    // Each bucket expects ~500; a gross bias (or a missing value) fails this.
    for (const c of counts) expect(c).toBeGreaterThan(350);
  });

  it("rejects invalid bounds", () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(1.5)).toThrow();
    expect(() => randomInt(2 ** 33)).toThrow();
  });

  it("builds numeric OTPs and Crockford codes of the requested length", () => {
    expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(randomCrockford(10)).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });
});

describe("hashing and MACs", () => {
  it("computes SHA-256 (FIPS 180-2 test vector)", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares in constant time and handles unequal lengths", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual(utf8(""), utf8(""))).toBe(true);
  });

  it("derives independent keys per purpose and per secret", async () => {
    const secret = "a".repeat(40);
    const otp = await hmacHex(secret, "otp", "value");
    expect(otp).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex(secret, "otp", "value")).toBe(otp);
    expect(await hmacHex(secret, "recovery-code", "value")).not.toBe(otp);
    expect(await hmacHex("b".repeat(40), "otp", "value")).not.toBe(otp);
  });

  it("verifies MACs made with the previous secret during rotation", async () => {
    const previous = "p".repeat(40);
    const current = "c".repeat(40);
    const mac = await hmacHex(previous, "form-token", "payload");
    expect(await hmacMatches([current, previous], "form-token", "payload", mac)).toBe(true);
    expect(await hmacMatches([current], "form-token", "payload", mac)).toBe(false);
    expect(await hmacMatches([current, previous], "form-token", "other", mac)).toBe(false);
  });
});

describe("identifiers", () => {
  it("creates prefixed ULIDs that validate by kind", () => {
    const id = newId("user");
    expect(id).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isId(id)).toBe(true);
    expect(isId(id, "user")).toBe(true);
    expect(isId(id, "session")).toBe(false);
    expect(isId("usr_123")).toBe(false);
    expect(isId("usr_' OR 1=1 --xxxxxxxxxxxxxxxxxx")).toBe(false);
    expect(isId(42)).toBe(false);
  });

  it("sorts by creation time", () => {
    const earlier = ulid(1_700_000_000_000);
    const later = ulid(1_700_000_000_001);
    expect(earlier < later).toBe(true);
    expect(earlier.slice(0, 10)).not.toBe(later.slice(0, 10));
  });
});
