/**
 * Login risk scoring from real, observable signals only. Pure function — the caller gathers the
 * history. Scores: ≥30 requires an email code even for non-privileged users; ≥60 also alerts.
 */
export interface LoginHistory {
  /** Successful sign-ins for this user in the lookback window (newest first). */
  successes: {
    deviceHash: string | null;
    country: string | null;
    asn: number | null;
    createdAt: number;
  }[];
  /** Failed password/2FA attempts on this account in the last 15 minutes. */
  recentAccountFailures: number;
  /** Distinct accounts with failures from this IP hash in the last hour. */
  ipFailedAccounts: number;
}

export interface LoginSignals {
  deviceHash: string;
  country: string | null;
  asn: number | null;
  now: number;
}

export interface RiskAssessment {
  score: number;
  reasons: string[];
}

export const RISK_THRESHOLDS = { requireCode: 30, alert: 60 } as const;

const TWO_HOURS = 2 * 60 * 60 * 1000;

export function assessLoginRisk(history: LoginHistory, current: LoginSignals): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;
  const hasHistory = history.successes.length > 0;

  if (hasHistory && !history.successes.some((s) => s.deviceHash === current.deviceHash)) {
    score += 25;
    reasons.push("new_device");
  }
  if (
    hasHistory &&
    current.country &&
    !history.successes.some((s) => s.country === current.country)
  ) {
    score += 30;
    reasons.push("new_country");
  }
  if (hasHistory && current.asn !== null && !history.successes.some((s) => s.asn === current.asn)) {
    score += 10;
    reasons.push("new_network");
  }
  if (history.recentAccountFailures > 0) {
    score += Math.min(30, history.recentAccountFailures * 5);
    reasons.push("recent_failures");
  }
  const last = history.successes[0];
  if (
    last?.country &&
    current.country &&
    last.country !== current.country &&
    current.now - last.createdAt < TWO_HOURS
  ) {
    score += 30;
    reasons.push("rapid_country_change");
  }
  if (history.ipFailedAccounts >= 5) {
    score += 40;
    reasons.push("ip_credential_stuffing_pattern");
  }
  return { score: Math.min(100, score), reasons };
}
