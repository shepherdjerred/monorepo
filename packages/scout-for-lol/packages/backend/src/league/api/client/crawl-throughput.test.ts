import { describe, expect, test } from "vitest";
import { crawlThroughput } from "./crawl-throughput.ts";

describe("crawlThroughput", () => {
  test("a 0.25 ceiling on 50 rps is 12.5 rps and 1.08M requests per day", () => {
    const result = crawlThroughput({
      ceiling: 0.25,
      hostRequestsPerSecond: 50,
    });
    expect(result.requestsPerSecond).toBe(12.5);
    expect(result.requestsPerDay).toBe(1_080_000);
    expect(result.matchesPerDay).toBeUndefined();
  });

  test("divides requests by the per-match cost", () => {
    const result = crawlThroughput({
      ceiling: 0.25,
      hostRequestsPerSecond: 50,
      requestsPerMatch: 20,
    });
    expect(result.matchesPerDay).toBe(54_000);
  });
});
