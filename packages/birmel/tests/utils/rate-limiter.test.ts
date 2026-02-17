import { describe, test, expect, beforeEach } from "bun:test";
import {
  checkRateLimit,
  getRateLimitRemaining,
  getRateLimitResetTime,
  clearRateLimit,
  clearAllRateLimits,
  cleanupExpiredLimits,
} from "../../src/utils/rate-limiter.js";

describe("rate-limiter", () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  describe("checkRateLimit", () => {
    test("allows first request", () => {
      expect(checkRateLimit("test-key", 5, 1000)).toBe(true);
    });

    test("allows requests up to limit", () => {
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit("test-key", 5, 1000)).toBe(true);
      }
    });

    test("blocks requests over limit", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("test-key", 5, 1000);
      }
      expect(checkRateLimit("test-key", 5, 1000)).toBe(false);
    });

    test("tracks different keys independently", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("key-1", 5, 1000);
      }

      expect(checkRateLimit("key-1", 5, 1000)).toBe(false);
      expect(checkRateLimit("key-2", 5, 1000)).toBe(true);
    });

    test("resets after window expires", async () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("test-key", 5, 50);
      }
      expect(checkRateLimit("test-key", 5, 50)).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(checkRateLimit("test-key", 5, 50)).toBe(true);
    });
  });

  describe("getRateLimitRemaining", () => {
    test("returns max for unknown key", () => {
      expect(getRateLimitRemaining("unknown-key", 10)).toBe(10);
    });

    test("returns remaining after some requests", () => {
      checkRateLimit("test-key", 10, 1000);
      checkRateLimit("test-key", 10, 1000);
      checkRateLimit("test-key", 10, 1000);

      expect(getRateLimitRemaining("test-key", 10)).toBe(7);
    });

    test("returns 0 when limit reached", () => {
      for (let i = 0; i < 10; i++) {
        checkRateLimit("test-key", 10, 1000);
      }

      expect(getRateLimitRemaining("test-key", 10)).toBe(0);
    });
  });

  describe("getRateLimitResetTime", () => {
    test("returns null for unknown key", () => {
      expect(getRateLimitResetTime("unknown-key")).toBeNull();
    });

    test("returns reset time for active limit", () => {
      const before = Date.now();
      checkRateLimit("test-key", 5, 1000);
      const after = Date.now();
      const resetTime = getRateLimitResetTime("test-key");

      expect(resetTime).not.toBeNull();
      expect(resetTime).toBeGreaterThanOrEqual(before + 1000);
      expect(resetTime).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe("clearRateLimit", () => {
    test("removes rate limit for key", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("test-key", 5, 1000);
      }
      expect(checkRateLimit("test-key", 5, 1000)).toBe(false);

      clearRateLimit("test-key");
      expect(checkRateLimit("test-key", 5, 1000)).toBe(true);
    });

    test("does not affect other keys", () => {
      checkRateLimit("key-1", 5, 1000);
      checkRateLimit("key-2", 5, 1000);

      clearRateLimit("key-1");

      expect(getRateLimitRemaining("key-1", 5)).toBe(5);
      expect(getRateLimitRemaining("key-2", 5)).toBe(4);
    });
  });

  describe("clearAllRateLimits", () => {
    test("removes all rate limits", () => {
      checkRateLimit("key-1", 5, 1000);
      checkRateLimit("key-2", 5, 1000);

      clearAllRateLimits();

      expect(getRateLimitRemaining("key-1", 5)).toBe(5);
      expect(getRateLimitRemaining("key-2", 5)).toBe(5);
    });
  });

  describe("cleanupExpiredLimits", () => {
    test("removes expired limits", async () => {
      checkRateLimit("test-key", 5, 50);

      await new Promise((resolve) => setTimeout(resolve, 60));

      const cleaned = cleanupExpiredLimits();
      expect(cleaned).toBe(1);
    });

    test("keeps active limits", () => {
      checkRateLimit("test-key", 5, 10000);

      const cleaned = cleanupExpiredLimits();
      expect(cleaned).toBe(0);
      expect(getRateLimitRemaining("test-key", 5)).toBe(4);
    });
  });
});
