export const CLOUD_VERIFICATION_WINDOW_MS = 60_000;
export const CLOUD_VERIFICATION_MAX_ATTEMPTS = 5;
const BURST_CAPACITY = 2;
const REJECTION_COOLDOWN_MS = 3000;

/**
 * How long to stop calling OpenAI after it reports the account's quota is spent.
 *
 * The production spend ceiling lives on the OpenAI project token, so exhausting it is an expected
 * monthly event rather than an error. A refused request bills nothing, so re-probing periodically
 * costs only latency and lets voice recover on its own when the period rolls over.
 */
const QUOTA_BACKOFF_MS = 3_600_000;

export type CloudVerificationRateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "burst" | "minute" | "cooldown" | "quota";
    };

/** Per-playback-session limiter: burst two, five attempts/minute, rejection cooldown. */
export class CloudVerificationRateLimiter {
  private attempts: number[] = [];
  private tokens = BURST_CAPACITY;
  private lastRefillMs: number;
  private cooldownUntilMs = 0;
  private quotaUntilMs = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.lastRefillMs = now();
  }

  tryAcquire(): CloudVerificationRateLimitDecision {
    const nowMs = this.now();
    // Checked before the cooldown and burst gates: once the account's quota is spent, every
    // request would fail anyway, so the local cascade should stop reaching for the network at all.
    if (nowMs < this.quotaUntilMs) {
      return { allowed: false, reason: "quota" };
    }
    if (nowMs < this.cooldownUntilMs) {
      return { allowed: false, reason: "cooldown" };
    }
    this.attempts = this.attempts.filter(
      (attemptMs) => nowMs - attemptMs < CLOUD_VERIFICATION_WINDOW_MS,
    );
    if (this.attempts.length >= CLOUD_VERIFICATION_MAX_ATTEMPTS) {
      return { allowed: false, reason: "minute" };
    }
    const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
    this.tokens = Math.min(
      BURST_CAPACITY,
      this.tokens +
        (elapsedMs / CLOUD_VERIFICATION_WINDOW_MS) *
          CLOUD_VERIFICATION_MAX_ATTEMPTS,
    );
    this.lastRefillMs = nowMs;
    if (this.tokens < 1) return { allowed: false, reason: "burst" };
    this.tokens -= 1;
    this.attempts.push(nowMs);
    return { allowed: true };
  }

  /** True when a prior turn already saw the quota refusal and the backoff has not elapsed. */
  isQuotaExhausted(): boolean {
    return this.now() < this.quotaUntilMs;
  }

  /** OpenAI refused for spend reasons; hold off until the backoff elapses. */
  recordQuotaExhausted(): void {
    this.quotaUntilMs = this.now() + QUOTA_BACKOFF_MS;
  }

  recordTranscriptRejection(): void {
    this.cooldownUntilMs = Math.max(
      this.cooldownUntilMs,
      this.now() + REJECTION_COOLDOWN_MS,
    );
  }
}
