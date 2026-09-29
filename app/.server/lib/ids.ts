import { randomBytes } from "./crypto";
import { CROCKFORD } from "./encoding";

/**
 * Prefixed, time-sortable identifiers: `<prefix>_<ULID>`.
 * ULID = 48-bit millisecond timestamp (10 chars) + 80 bits of randomness (16 chars), Crockford
 * base32. IDs sort by creation time, carry no sequence information, and are never used as a
 * security boundary — authorisation always checks ownership explicitly.
 */
export const ID_PREFIXES = {
  user: "usr",
  session: "ses",
  role: "rol",
  factor: "mfa",
  challenge: "chl",
  recovery: "rcv",
  token: "tok",
  invitation: "inv",
  loginAttempt: "lga",
  securityEvent: "sev",
  audit: "aud",
  notification: "ntf",
  email: "eml",
  job: "job",
  social: "soc",
  project: "prj",
  service: "svc",
  page: "pge",
  partner: "prt",
  jobRole: "jbr",
  version: "ver",
  preview: "prv",
  redirect: "rdr",
  media: "med",
  mediaRevision: "mrv",
  enquiry: "enq",
  enquiryEvent: "eqe",
  application: "app",
  applicationEvent: "ape",
  clientOrg: "org",
  engagement: "eng",
  milestone: "mst",
  deliverable: "dlv",
  engagementFile: "efl",
  message: "msg",
  aiPrompt: "aip",
  aiConversation: "aic",
  aiMessage: "aim",
  aiUsage: "aiu",
  privacyRequest: "pvr",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

function encodeTime(ms: number): string {
  let value = ms;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(10); // 80 bits
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out; // exactly 16 chars
}

export function ulid(now = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export function newId(kind: IdKind, now = Date.now()): string {
  return `${ID_PREFIXES[kind]}_${ulid(now)}`;
}

const ID_PATTERN = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Validates the shape of an ID (and optionally its kind) before it reaches a query. */
export function isId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return false;
  return kind ? value.startsWith(`${ID_PREFIXES[kind]}_`) : true;
}
