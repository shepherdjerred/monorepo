import { describe, expect, test } from "vitest";
import { runSettledWorkers } from "#src/league/explore-history/worker-pool.ts";

describe("runSettledWorkers", () => {
  test("waits for sibling workers to settle before propagating a failure", async () => {
    const slowWorker = Promise.withResolvers<boolean>();
    let workerIndex = 0;
    let slowFinished = false;
    const run = runSettledWorkers(2, async () => {
      const index = workerIndex;
      workerIndex += 1;
      if (index === 0) throw new Error("Riot read failed");
      await slowWorker.promise;
      slowFinished = true;
    });
    const observedSlowState = (async (): Promise<boolean> => {
      try {
        await run;
      } catch {
        return slowFinished;
      }
      return slowFinished;
    })();

    await Promise.resolve();
    slowWorker.resolve(true);

    await expect(observedSlowState).resolves.toBe(true);
    await expect(run).rejects.toThrow("Riot read failed");
  });
});
