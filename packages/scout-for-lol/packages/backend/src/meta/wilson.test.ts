import { describe, expect, test } from "vitest";
import { wilsonInterval } from "#src/meta/wilson.ts";

describe("wilsonInterval", () => {
  test.each([
    { wins: 50, games: 100, lower: 0.40383, upper: 0.59617 },
    { wins: 520, games: 1000, lower: 0.48902, upper: 0.55083 },
    { wins: 1, games: 1, lower: 0.20655, upper: 1 },
    { wins: 0, games: 10, lower: 0, upper: 0.27753 },
    { wins: 10, games: 10, lower: 0.72247, upper: 1 },
  ])("$wins of $games", ({ wins, games, lower, upper }) => {
    const interval = wilsonInterval(wins, games);
    expect(interval.value).toBeCloseTo(wins / games, 10);
    expect(interval.lower).toBeCloseTo(lower, 3);
    expect(interval.upper).toBeCloseTo(upper, 3);
  });

  test("an empty sample says nothing: the whole unit interval", () => {
    expect(wilsonInterval(0, 0)).toEqual({ value: 0, lower: 0, upper: 1 });
  });

  test("the interval narrows as the sample grows and stays inside [0, 1]", () => {
    const small = wilsonInterval(6, 10);
    const large = wilsonInterval(600, 1000);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
    for (const interval of [small, large, wilsonInterval(0, 3)]) {
      expect(interval.lower).toBeGreaterThanOrEqual(0);
      expect(interval.upper).toBeLessThanOrEqual(1);
    }
  });

  test("rejects counts that cannot be a sample", () => {
    expect(() => wilsonInterval(3, 2)).toThrow("0 <= successes <= total");
    expect(() => wilsonInterval(-1, 2)).toThrow("0 <= successes <= total");
    expect(() => wilsonInterval(1.5, 2)).toThrow("integer counts");
  });
});
