import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLogLevel } from "~/.server/kernel/app";
import { createLogger, describeError, redact, scrubSecrets } from "~/.server/observability/logger";

/** CP-2.1 decisions on the CP-1 observations O-1 (maintenance log level) and O-2 (scrubbing). */

// Assembled at runtime so this file never contains a credential-shaped literal.
const resendKey = `re_${"a1b2c3d4"}_${"Q".repeat(20)}`;
const googleKey = `AIza${"S".repeat(35)}`;
const turnstileSecret = `0x4AAAAAAA${"B".repeat(25)}`;
const jwt = `eyJ${"a".repeat(12)}.eyJ${"b".repeat(12)}.${"c".repeat(16)}`;
const githubToken = `ghp_${"x".repeat(36)}`;
const privateKey = `-----BEGIN ${"PRIVATE"} KEY-----\nMIIabc\n-----END ${"PRIVATE"} KEY-----`;

describe("O-1 · request log level", () => {
  it("logs genuine 5xx as errors and the planned maintenance 503 at info", () => {
    expect(requestLogLevel(500, false)).toBe("error");
    expect(requestLogLevel(503, false)).toBe("error"); // e.g. configuration or database down
    expect(requestLogLevel(503, true)).toBe("info");
    expect(requestLogLevel(200, false)).toBe("info");
    expect(requestLogLevel(404, false)).toBe("info");
  });
});

describe("O-2 · credential scrubbing in free text", () => {
  it("removes credentials embedded in messages", () => {
    const cases: [string, string, string][] = [
      ["D1 password=hunter2 failed", "hunter2", "password=[redacted]"],
      ['{"secret": "s3cr3t-value"}', "s3cr3t-value", "[redacted]"],
      ["Authorization: Bearer abcdef123456", "abcdef123456", "Bearer [redacted]"],
      [`resend said: invalid key ${resendKey}`, resendKey, "[redacted:resend-key]"],
      [`key=${googleKey}`, googleKey, "[redacted:google-key]"],
      [`siteverify with ${turnstileSecret}`, turnstileSecret, "[redacted:turnstile-secret]"],
      [`token ${jwt}`, jwt, "[redacted:jwt]"],
      [`clone with ${githubToken}`, githubToken, "[redacted:github-token]"],
      ["cookie: __Host-vora_session=abcDEF123; Path=/", "abcDEF123", "vora_session=[redacted]"],
      ["GET /reset?token=Zx81kLq0pR", "Zx81kLq0pR", "token=[redacted]"],
      ["your sign-in code 482913 expires", "482913", "sign-in code [redacted]"],
      [privateKey, "MIIabc", "[redacted:private-key]"],
    ];
    for (const [input, leaked, marker] of cases) {
      const out = scrubSecrets(input);
      expect(out, input).not.toContain(leaked);
      expect(out, input).toContain(marker);
    }
  });

  it("leaves ordinary diagnostics readable", () => {
    for (const text of [
      "A request to the Cloudflare API failed. [code: 10021]",
      "setup token: mismatch",
      "token expired",
      "no such table: users",
      "status 503 for a@b.co",
      "UNIQUE constraint failed: users.email",
    ]) {
      expect(scrubSecrets(text)).toBe(text);
    }
  });

  it("applies to logged errors, messages and stack traces, after key-based redaction", () => {
    const error = new Error("D1 password=hunter2 rejected");
    const described = redact(describeError(error)) as Record<string, string>;
    expect(JSON.stringify(described)).not.toContain("hunter2");
    expect(described.errorMessage).toBe("D1 password=[redacted] rejected");
    expect(JSON.stringify(redact({ cause: error }))).not.toContain("hunter2");
    // Key-based redaction and the 2000-character cap still apply.
    expect(redact({ apiKey: "anything" })).toEqual({ apiKey: "[redacted]" });
    expect((redact("x".repeat(3000)) as string).length).toBe(2001);
  });
});

describe("O-2 · logger output", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes a scrubbed credential to the console", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    createLogger({ requestId: "r" }).error("page_render_failed", {
      ...describeError(new Error(`Bearer abcdef123456 and ${resendKey}`)),
    });
    const line = JSON.stringify(err.mock.calls[0]?.[0]);
    expect(line).toContain('"requestId":"r"');
    expect(line).not.toContain("abcdef123456");
    expect(line).not.toContain(resendKey);
  });
});
