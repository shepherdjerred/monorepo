import { describe, expect, it } from "vitest";
import {
  QUALIFICATION_CONCURRENCY,
  qualifyPendingBuilds,
} from "./qualification-sweep.ts";

/** One main pipeline registers a build for every catalog service. */
const pipeline = Array.from({ length: 90 }, (_, index) => ({
  id: `build-${index.toString()}`,
}));

describe("qualifyPendingBuilds", () => {
  it("drains a whole pipeline's builds in one tick instead of three", async () => {
    const qualified: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const attempted = await qualifyPendingBuilds(pipeline, async (id) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      qualified.push(id);
      inFlight -= 1;
    });
    expect(attempted).toBe(90);
    expect(qualified).toEqual(pipeline.map((build) => build.id));
    expect(peak).toBe(QUALIFICATION_CONCURRENCY);
  });

  it("starts no wave after the tick's budget is spent", async () => {
    let clock = 0;
    const qualified: string[] = [];
    const attempted = await qualifyPendingBuilds(
      pipeline,
      (id) => {
        clock += 4000;
        qualified.push(id);
        return Promise.resolve();
      },
      { now: () => clock, budgetMs: 30_000 },
    );
    // Each wave of three advances the clock 12s: waves start at 0, 12s and 24s.
    expect(attempted).toBe(9);
    expect(qualified).toEqual(pipeline.slice(0, 9).map((build) => build.id));
  });

  it("fails the tick after the rejecting wave settles", async () => {
    const qualified: string[] = [];
    const failure = new Error(
      "Delivery API builds/build-4/qualify returned 500",
    );
    await expect(
      qualifyPendingBuilds(pipeline, async (id) => {
        await Promise.resolve();
        if (id === "build-4") throw failure;
        qualified.push(id);
      }),
    ).rejects.toBe(failure);
    expect(qualified).toEqual([
      "build-0",
      "build-1",
      "build-2",
      "build-3",
      "build-5",
    ]);
  });
});
