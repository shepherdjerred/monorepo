import { describe, expect, test } from "bun:test";
import { probeEmbeddingAvailability } from "./embeddings.ts";

describe("probeEmbeddingAvailability", () => {
  test("reports available after startup succeeds", async () => {
    let cleanupCalled = false;

    const available = await probeEmbeddingAvailability(
      () => Promise.resolve(),
      () => {
        cleanupCalled = true;
        return Promise.resolve();
      },
    );

    expect(available).toBe(true);
    expect(cleanupCalled).toBe(false);
  });

  test("waits for cleanup before reporting a startup failure", async () => {
    const cleanupStarted = Promise.withResolvers<true>();
    const cleanupFinished = Promise.withResolvers<true>();
    let settled = false;

    const availability = (async () => {
      try {
        return await probeEmbeddingAvailability(
          () => Promise.reject(new Error("startup failed")),
          async () => {
            cleanupStarted.resolve(true);
            await cleanupFinished.promise;
          },
        );
      } finally {
        settled = true;
      }
    })();

    await cleanupStarted.promise;
    expect(settled).toBe(false);

    cleanupFinished.resolve(true);
    await expect(availability).resolves.toBe(false);
    expect(settled).toBe(true);
  });

  test("preserves startup and cleanup failures", async () => {
    const startupError = new Error("startup failed");
    const cleanupError = new Error("cleanup failed");

    const availability = probeEmbeddingAvailability(
      () => Promise.reject(startupError),
      () => Promise.reject(cleanupError),
    );

    try {
      await availability;
      throw new Error("availability unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) throw error;
      expect(error.message).toBe("Embedding server startup and cleanup failed");
      expect(error.errors).toEqual([startupError, cleanupError]);
      expect(error.cause).toBe(cleanupError);
    }
  });
});
