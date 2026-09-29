/** Injectable clock so time-dependent logic (expiry, lockouts, retention) is testable. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
