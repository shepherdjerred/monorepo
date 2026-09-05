import { describe, expect, test } from "vitest";
import { downsampleBalanceSeries } from "#src/betting/accounts/balance-chart.ts";

function entry(iso: string, balanceAfter: number) {
  return { createdAt: new Date(iso), balanceAfter };
}

describe("downsampleBalanceSeries", () => {
  test("keeps the last balance of each day, in order", () => {
    const points = downsampleBalanceSeries([
      entry("2030-01-01T10:00:00Z", 20),
      entry("2030-01-01T18:00:00Z", 25),
      entry("2030-01-03T09:00:00Z", 5),
    ]);
    expect(points.map((point) => point.value)).toEqual([25, 5]);
  });

  test("thins a very long history but never drops the newest point", () => {
    const entries = Array.from({ length: 500 }, (_unused, index) =>
      entry(
        new Date(
          Date.UTC(2028, 0, 1) + index * 24 * 60 * 60 * 1000,
        ).toISOString(),
        index,
      ),
    );
    const points = downsampleBalanceSeries(entries);
    expect(points.length).toBeLessThanOrEqual(251);
    expect(points.at(-1)?.value).toBe(499);
  });
});
