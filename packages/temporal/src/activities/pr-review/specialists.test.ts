import { describe, expect, it } from "bun:test";
import {
  SPECIALIST_PASS_CONCURRENCY,
  runWithConcurrency,
} from "./specialists.ts";

describe("runWithConcurrency", () => {
  it("preserves result order while bounding active work", async () => {
    let activeJobs = 0;
    let maxActiveJobs = 0;
    const jobs = Array.from({ length: 9 }, (_, index) => async () => {
      activeJobs++;
      maxActiveJobs = Math.max(maxActiveJobs, activeJobs);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeJobs--;
      return index;
    });

    const results = await runWithConcurrency(jobs, SPECIALIST_PASS_CONCURRENCY);

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(maxActiveJobs).toBe(SPECIALIST_PASS_CONCURRENCY);
    expect(activeJobs).toBe(0);
  });

  it("rejects invalid concurrency", async () => {
    await expect(runWithConcurrency([], 0)).rejects.toThrow(
      "concurrency must be at least 1",
    );
  });
});
