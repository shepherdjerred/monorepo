import { describe, expect, test } from "vitest";
import { CloudVerificationRateLimiter } from "@shepherdjerred/streambot/voice/cloud-verification-rate-limiter.ts";

describe("CloudVerificationRateLimiter", () => {
  test("allows a burst of two and at most five attempts in a rolling minute", () => {
    let nowMs = 0;
    const limiter = new CloudVerificationRateLimiter(() => nowMs);
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
    expect(limiter.tryAcquire()).toEqual({ allowed: false, reason: "burst" });

    nowMs = 12_000;
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
    nowMs = 24_000;
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
    nowMs = 36_000;
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
    nowMs = 48_000;
    expect(limiter.tryAcquire()).toEqual({ allowed: false, reason: "minute" });

    nowMs = 60_001;
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
  });

  test("enforces a three-second cooldown after transcript rejection", () => {
    let nowMs = 0;
    const limiter = new CloudVerificationRateLimiter(() => nowMs);
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
    limiter.recordTranscriptRejection();
    nowMs = 2999;
    expect(limiter.tryAcquire()).toEqual({
      allowed: false,
      reason: "cooldown",
    });
    nowMs = 3000;
    expect(limiter.tryAcquire()).toEqual({ allowed: true });
  });
});
