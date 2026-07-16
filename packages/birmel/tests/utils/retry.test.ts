import { describe, test, expect } from "bun:test";
import {
  retry,
  isRetryableError,
  retryWithBackoff,
} from "@shepherdjerred/birmel/utils/retry.ts";

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
      // Capture the *requested* backoff delays via an injected sleep rather
      // than measuring wall-clock time, which is flaky under CI load (the
      // first setTimeout(50) can fire later than the second setTimeout(100)
      // when the event loop is starved — main build 5042). Same pattern as
      // "respects maxDelayMs" below.
      const delays: number[] = [];

      await expect(
        retry(
          () => {
            throw new Error("fail");
          },
          {
            maxAttempts: 4,
            initialDelayMs: 50,
            backoffMultiplier: 2,
            sleep: (ms) => {
              delays.push(ms);
              return Promise.resolve();
            },
          },
        ),
      ).rejects.toThrow();

      // 4 attempts → 3 waits, doubling each time.
      expect(delays).toEqual([50, 100, 200]);
    });

    test("respects maxDelayMs", async () => {
      // Capture the *requested* backoff delays via an injected sleep rather
      // than measuring wall-clock time, which is flaky under CI load (a
      // setTimeout(100) can fire hundreds of ms late when the event loop is
      // starved). This asserts the capping logic deterministically.
      const delays: number[] = [];

      await expect(
        retry(
          () => {
            throw new Error("fail");
          },
          {
            maxAttempts: 5,
            initialDelayMs: 50,
            maxDelayMs: 100,
            backoffMultiplier: 3,
            sleep: (ms) => {
              delays.push(ms);
              return Promise.resolve();
            },
          },
        ),
      ).rejects.toThrow();

      // 5 attempts → 4 waits. Backoff: 50, then 50*3=150→100 (capped),
      // 100*3=300→100, 100*3=300→100. Every delay is <= maxDelayMs.
      expect(delays).toEqual([50, 100, 100, 100]);
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(100);
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
