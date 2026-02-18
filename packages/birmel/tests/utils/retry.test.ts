import { describe, test, expect } from "bun:test";
import {
  retry,
  isRetryableError,
  retryWithBackoff,
} from "../../src/utils/retry.js";

describe("retry", () => {
  describe("retry", () => {
    test("returns result on success", async () => {
      const result = await retry(() => Promise.resolve("success"));
      expect(result).toBe("success");
    });

    test("retries on failure", async () => {
      let attempts = 0;
      const result = await retry(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error("fail");
          }
          return Promise.resolve("success");
        },
        { initialDelayMs: 10, maxAttempts: 3 },
      );

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    test("throws after max attempts", async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error("always fails");
          },
          { maxAttempts: 3, initialDelayMs: 10 },
        ),
      ).rejects.toThrow("always fails");

      expect(attempts).toBe(3);
    });

    test("respects shouldRetry", async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error("non-retryable");
          },
          {
            maxAttempts: 5,
            initialDelayMs: 10,
            shouldRetry: () => false,
          },
        ),
      ).rejects.toThrow("non-retryable");

      expect(attempts).toBe(1);
    });

    test("uses exponential backoff", async () => {
      const delays: number[] = [];
      let lastTime = 0;
      let isFirstCall = true;

      await expect(
        retry(
          () => {
            const now = Date.now();
            if (!isFirstCall) {
              delays.push(now - lastTime);
            }
            isFirstCall = false;
            lastTime = now;
            throw new Error("fail");
          },
          {
            maxAttempts: 4,
            initialDelayMs: 50,
            backoffMultiplier: 2,
          },
        ),
      ).rejects.toThrow();

      // Check that delays increase (with some tolerance)
      // With 4 attempts, there are 3 delays between them
      expect(delays.length).toBe(3);
      const firstDelay = delays[0];
      const secondDelay = delays[1];
      expect(firstDelay).toBeDefined();
      expect(secondDelay).toBeDefined();
      if (firstDelay !== undefined && secondDelay !== undefined) {
        expect(firstDelay).toBeGreaterThanOrEqual(40);
        expect(secondDelay).toBeGreaterThan(firstDelay);
      }
    });

    test("respects maxDelayMs", async () => {
      const delays: number[] = [];
      let lastTime = Date.now();

      await expect(
        retry(
          () => {
            const now = Date.now();
            if (lastTime !== now) {
              delays.push(now - lastTime);
            }
            lastTime = now;
            throw new Error("fail");
          },
          {
            maxAttempts: 5,
            initialDelayMs: 50,
            maxDelayMs: 100,
            backoffMultiplier: 3,
          },
        ),
      ).rejects.toThrow();

      // All delays should be capped at maxDelayMs (with tolerance)
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(150);
      }
    });
  });

  describe("isRetryableError", () => {
    test("returns true for network errors", () => {
      expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
      expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
    });

    test("returns true for rate limit errors", () => {
      expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
      expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
    });

    test("returns true for server errors", () => {
      expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(
        true,
      );
      expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
      expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
      expect(isRetryableError(new Error("504 Gateway Timeout"))).toBe(true);
    });

    test("returns false for non-retryable errors", () => {
      expect(isRetryableError(new Error("404 Not Found"))).toBe(false);
      expect(isRetryableError(new Error("Invalid input"))).toBe(false);
      expect(isRetryableError(new Error("Permission denied"))).toBe(false);
    });

    test("returns false for non-Error values", () => {
      expect(isRetryableError("string error")).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError()).toBe(false);
    });
  });

  describe("retryWithBackoff", () => {
    test("uses isRetryableError for shouldRetry", async () => {
      let attempts = 0;

      await expect(
        retryWithBackoff(() => {
          attempts++;
          throw new Error("404 Not Found");
        }, 3),
      ).rejects.toThrow("404 Not Found");

      // Should not retry because 404 is not retryable
      expect(attempts).toBe(1);
    });

    test("retries for retryable errors", async () => {
      let attempts = 0;

      await expect(
        retryWithBackoff(() => {
          attempts++;
          throw new Error("ECONNRESET");
        }, 2),
      ).rejects.toThrow("ECONNRESET");

      expect(attempts).toBe(2);
    });
  });
});
