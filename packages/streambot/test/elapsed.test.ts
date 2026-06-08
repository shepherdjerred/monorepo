import { describe, expect, test } from "bun:test";
import { computeElapsed } from "@shepherdjerred/streambot/streamer/elapsed.ts";

describe("computeElapsed", () => {
  test("offset plus wall-clock seconds since the segment started", () => {
    expect(computeElapsed(0, 1000, 1000)).toBe(0);
    expect(computeElapsed(0, 1000, 6000)).toBe(5);
    expect(computeElapsed(30, 1000, 6000)).toBe(35);
  });

  test("advances monotonically as the clock advances", () => {
    const start = 10_000;
    const a = computeElapsed(100, start, start + 1000);
    const b = computeElapsed(100, start, start + 2000);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeCloseTo(1, 5);
  });

  test("never returns a negative position even with clock skew", () => {
    // now before start (clock went backwards) should clamp at 0, not go negative.
    expect(computeElapsed(0, 5000, 4000)).toBe(0);
    expect(computeElapsed(2, 5000, 1000)).toBe(0);
  });
});
