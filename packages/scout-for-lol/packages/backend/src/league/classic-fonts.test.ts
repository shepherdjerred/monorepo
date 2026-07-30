import { describe, expect, test } from "bun:test";
import { createClassicFontInitializer } from "./classic-fonts.ts";

describe("Classic font initialization", () => {
  test("shares one successful initialization across concurrent callers", async () => {
    const attempt = Promise.withResolvers<undefined>();
    let initializationCount = 0;
    const ensureConfigured = createClassicFontInitializer(() => {
      initializationCount += 1;
      return attempt.promise;
    });

    const firstCaller = ensureConfigured();
    const secondCaller = ensureConfigured();
    expect(initializationCount).toBe(1);

    attempt.resolve(undefined);
    await Promise.all([firstCaller, secondCaller]);
    await ensureConfigured();

    expect(initializationCount).toBe(1);
  });

  test("shares a rejected attempt and retries once for later callers", async () => {
    const firstAttempt = Promise.withResolvers<undefined>();
    const retryAttempt = Promise.withResolvers<undefined>();
    let initializationCount = 0;
    const ensureConfigured = createClassicFontInitializer(() => {
      initializationCount += 1;
      if (initializationCount === 1) {
        return firstAttempt.promise;
      }
      return retryAttempt.promise;
    });

    const firstCaller = ensureConfigured();
    const concurrentFirstCaller = ensureConfigured();
    expect(initializationCount).toBe(1);

    firstAttempt.reject(new Error("private font storage unavailable"));
    await expect(
      Promise.all([firstCaller, concurrentFirstCaller]),
    ).rejects.toThrow("private font storage unavailable");

    const retryCaller = ensureConfigured();
    const concurrentRetryCaller = ensureConfigured();
    expect(initializationCount).toBe(2);

    retryAttempt.resolve(undefined);
    await Promise.all([retryCaller, concurrentRetryCaller]);
    await ensureConfigured();

    expect(initializationCount).toBe(2);
  });
});
