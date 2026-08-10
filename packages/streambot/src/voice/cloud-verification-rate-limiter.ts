const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const BURST_CAPACITY = 2;
const REJECTION_COOLDOWN_MS = 3000;

export type CloudVerificationRateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "burst" | "minute" | "cooldown";
    };

/** Per-playback-session limiter: burst two, five attempts/minute, rejection cooldown. */
export class CloudVerificationRateLimiter {
  private attempts: number[] = [];
  private tokens = BURST_CAPACITY;
  private lastRefillMs: number;
  private cooldownUntilMs = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.lastRefillMs = now();
  }

  tryAcquire(): CloudVerificationRateLimitDecision {
    const nowMs = this.now();
    if (nowMs < this.cooldownUntilMs) {
      return { allowed: false, reason: "cooldown" };
    }
    this.attempts = this.attempts.filter(
      (attemptMs) => nowMs - attemptMs < WINDOW_MS,
    );
    if (this.attempts.length >= MAX_ATTEMPTS) {
      return { allowed: false, reason: "minute" };
    }
    const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
    this.tokens = Math.min(
      BURST_CAPACITY,
      this.tokens + (elapsedMs / WINDOW_MS) * MAX_ATTEMPTS,
    );
    this.lastRefillMs = nowMs;
    if (this.tokens < 1) return { allowed: false, reason: "burst" };
    this.tokens -= 1;
    this.attempts.push(nowMs);
    return { allowed: true };
  }

  recordTranscriptRejection(): void {
    this.cooldownUntilMs = Math.max(
      this.cooldownUntilMs,
      this.now() + REJECTION_COOLDOWN_MS,
    );
  }
}
