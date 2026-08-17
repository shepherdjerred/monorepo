import { describe, expect, test } from "bun:test";
import { CloudVerificationRateLimiter } from "@shepherdjerred/streambot/voice/cloud-verification-rate-limiter.ts";
import { isQuotaExhaustedError } from "@shepherdjerred/streambot/voice/quota-errors.ts";

describe("isQuotaExhaustedError", () => {
  test("matches OpenAI's spend-refusal codes wherever they are carried", () => {
    expect(isQuotaExhaustedError(new Error("429 insufficient_quota"))).toBe(
      true,
    );
    expect(
      isQuotaExhaustedError(
        Object.assign(new Error("Request failed"), {
          code: "insufficient_quota",
        }),
      ),
    ).toBe(true);
    expect(
      isQuotaExhaustedError(
        Object.assign(new Error("billing"), {
          type: "billing_hard_limit_reached",
        }),
      ),
    ).toBe(true);
    expect(
      isQuotaExhaustedError(
        new Error("wrapped", {
          cause: new Error("You exceeded your current quota"),
        }),
      ),
    ).toBe(true);
  });

  test("does not match ordinary rate limiting or unrelated failures", () => {
    // A bare 429 is throughput throttling. Treating it as a spend refusal would mute voice for an
    // hour every busy minute.
    expect(
      isQuotaExhaustedError(new Error("429 Too Many Requests: slow down")),
    ).toBe(false);
    expect(isQuotaExhaustedError(new Error("socket hang up"))).toBe(false);
    expect(isQuotaExhaustedError(undefined)).toBe(false);
    expect(isQuotaExhaustedError(null)).toBe(false);
  });
});

describe("CloudVerificationRateLimiter quota backoff", () => {
  test("stops allowing cloud calls once quota is exhausted, and recovers after the backoff", () => {
    let nowMs = 1000;
    const limiter = new CloudVerificationRateLimiter(() => nowMs);

    expect(limiter.tryAcquire().allowed).toBe(true);
    expect(limiter.isQuotaExhausted()).toBe(false);

    limiter.recordQuotaExhausted();
    expect(limiter.isQuotaExhausted()).toBe(true);
    const refused = limiter.tryAcquire();
    expect(refused).toEqual({ allowed: false, reason: "quota" });

    // Still refused well inside the backoff, so a spent budget cannot be re-probed on every wake.
    nowMs += 59 * 60 * 1000;
    expect(limiter.tryAcquire()).toEqual({ allowed: false, reason: "quota" });

    // Self-healing: a refused request bills nothing, so voice recovers without operator action.
    nowMs += 2 * 60 * 1000;
    expect(limiter.isQuotaExhausted()).toBe(false);
    expect(limiter.tryAcquire().allowed).toBe(true);
  });
});
