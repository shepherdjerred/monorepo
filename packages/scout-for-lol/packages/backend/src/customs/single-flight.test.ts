import { describe, expect, test } from "bun:test";
import { createSingleFlightRunner } from "#src/customs/single-flight.ts";

describe("customs reconciler single-flight runner", () => {
  test("skips overlapping runs and accepts the next run after completion", async () => {
    const firstRun = Promise.withResolvers<true>();
    let calls = 0;
    const run = createSingleFlightRunner(async () => {
      calls += 1;
      if (calls === 1) await firstRun.promise;
    });

    const activeRun = run();
    await run();
    expect(calls).toBe(1);

    firstRun.resolve(true);
    await activeRun;
    await run();
    expect(calls).toBe(2);
  });

  test("releases the guard when an operation fails", async () => {
    let calls = 0;
    const run = createSingleFlightRunner(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("reconciliation failed"))
        : Promise.resolve();
    });

    await expect(run()).rejects.toThrow("reconciliation failed");
    await run();
    expect(calls).toBe(2);
  });
});
