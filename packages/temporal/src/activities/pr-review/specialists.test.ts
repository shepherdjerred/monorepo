import { describe, expect, it } from "bun:test";
import {
  SPECIALIST_PASS_CONCURRENCY,
  runWithConcurrency,
  shouldStopSpecialistFanout,
} from "./specialists.ts";

class AnthropicRateLimitFixture extends Error {
  readonly status = 429;
  readonly error = { type: "rate_limit_error" };
}

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

describe("shouldStopSpecialistFanout", () => {
  it("stops remaining specialist passes after Anthropic provider limits", () => {
    expect(
      shouldStopSpecialistFanout(
        new AnthropicRateLimitFixture(
          "429 rate_limit_error request_id: req_rate_limit_1",
        ),
      ),
    ).toBe(true);
  });

  it("does not stop remaining specialist passes for ordinary failures", () => {
    expect(shouldStopSpecialistFanout(new Error("plain failure"))).toBe(false);
  });
});
