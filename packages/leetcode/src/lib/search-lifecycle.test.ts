import { describe, expect, test } from "bun:test";
import { shutdownEmbeddingProcess } from "./search-lifecycle.ts";

describe("shutdownEmbeddingProcess", () => {
  test("waits for the embedding process to exit", async () => {
    const started = Promise.withResolvers<true>();
    const finish = Promise.withResolvers<true>();
    let completed = false;
    const embedder = {
      async shutdown(): Promise<void> {
        started.resolve(true);
        await finish.promise;
        completed = true;
      },
    };

    const shutdown = shutdownEmbeddingProcess(embedder);
    await started.promise;
    expect(completed).toBe(false);

    finish.resolve(true);
    await shutdown;
    expect(completed).toBe(true);
  });

  test("propagates embedding process failures", async () => {
    const failure = new Error("embedding process failed");
    const embedder = {
      shutdown(): Promise<void> {
        return Promise.reject(failure);
      },
    };

    await expect(shutdownEmbeddingProcess(embedder)).rejects.toBe(failure);
  });

  test("does nothing when keyword search did not start an embedding process", async () => {
    await expect(shutdownEmbeddingProcess(null)).resolves.toBeUndefined();
  });
});
