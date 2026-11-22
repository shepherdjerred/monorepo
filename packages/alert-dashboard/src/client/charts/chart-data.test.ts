import uPlot from "uplot";
import { describe, expect, it } from "vitest";

import {
  alignChartSeries,
  expandThresholdRange,
  legendIndividualValue,
  stackAlignedSeries,
  stackedSeriesBands,
} from "./chart-data.ts";
import {
  barFillColor,
  seriesFillColor,
  STACKED_AREA_ALPHA,
  thresholdColor,
} from "./chart-palette.ts";
import { restingLegendIdxs } from "./legend-idxs.ts";

describe("stacked-area cumulative alignment & legend indexes", () => {
  it("computes cumulative upper series while keeping un-stacked values for the legend", () => {
    const raw = alignChartSeries([
      {
        name: "claude",
        points: [
          [100, 12],
          [200, 15],
          [300, 10],
        ],
      },
      {
        name: "codex",
        points: [
          [100, 5],
          [200, 8],
          [300, 4],
        ],
      },
      {
        name: "gemini",
        points: [
          [100, 3],
          [200, 2],
          [300, 6],
        ],
      },
    ]);

    const stacked = stackAlignedSeries(raw);
    expect(stacked).toEqual([
      [100, 200, 300],
      [12, 15, 10],
      [17, 23, 14],
      [20, 25, 20],
    ]);

    // Hover and resting legends read individual un-stacked series values.
    expect(restingLegendIdxs(raw)).toEqual([2, 2, 2, 2]);
    expect(legendIndividualValue(raw, 1, 2)).toBe(10);
    expect(legendIndividualValue(raw, 2, 2)).toBe(4);
    expect(legendIndividualValue(raw, 3, 2)).toBe(6);
    expect(legendIndividualValue(raw, 2, null)).toBeNull();
  });

  it("carries cumulative edges across partial series gaps without tearing upper bands", () => {
    const raw = alignChartSeries([
      {
        name: "a",
        points: [
          [10, 4],
          [20, 6],
          [30, 5],
        ],
      },
      {
        name: "b",
        points: [
          [10, 3],
          // missing at t=20 and t=30
        ],
      },
      {
        name: "c",
        points: [
          [10, 2],
          [20, 7],
          [30, 1],
        ],
      },
    ]);

    expect(raw).toEqual([
      [10, 20, 30],
      [4, 6, 5],
      [3, null, null],
      [2, 7, 1],
    ]);

    const stacked = stackAlignedSeries(raw);
    expect(stacked).toEqual([
      [10, 20, 30],
      [4, 6, 5],
      [7, 6, 5],
      [9, 13, 6],
    ]);

    // Resting legend points series `b` at its own newest real sample (idx 0),
    // while `a` and `c` point at idx 2.
    const resting = restingLegendIdxs(raw);
    expect(resting).toEqual([2, 2, 0, 2]);
    expect(legendIndividualValue(raw, 2, resting[2] ?? null)).toBe(3);
    expect(legendIndividualValue(raw, 2, 1)).toBeNull();
    expect(legendIndividualValue(raw, 3, 1)).toBe(7);
  });

  it("preserves full-timestamp gaps as null across all stacked series", () => {
    const raw: [number[], ...(number | null)[][]] = [
      [10, 20, 30],
      [5, null, 8],
      [2, null, 3],
    ];
    expect(stackAlignedSeries(raw)).toEqual([
      [10, 20, 30],
      [5, null, 8],
      [7, null, 11],
    ]);
    expect(stackAlignedSeries([[]])).toEqual([[]]);
  });

  it("builds adjacent uPlot bands and translucent fills (28% light, 32% dark)", () => {
    expect(STACKED_AREA_ALPHA.light).toBe(0.28);
    expect(STACKED_AREA_ALPHA.dark).toBe(0.32);
    expect(seriesFillColor("light", 0)).toBe("rgba(42, 120, 214, 0.28)");
    expect(seriesFillColor("dark", 0)).toBe("rgba(57, 135, 229, 0.32)");
    expect(barFillColor("light", 1)).toBe("rgba(235, 104, 52, 0.24)");

    const bands = stackedSeriesBands(3, (idx) => seriesFillColor("light", idx));
    expect(bands).toEqual([
      { series: [2, 1], fill: "rgba(235, 104, 52, 0.28)" },
      { series: [3, 2], fill: "rgba(27, 175, 122, 0.28)" },
    ]);
    expect(
      stackedSeriesBands(1, (idx) => seriesFillColor("light", idx)),
    ).toEqual([]);
  });

  it("expands y-scale range so threshold values always remain visible", () => {
    const [minAbove, maxAbove] = expandThresholdRange(
      10,
      40,
      100,
      (lo, hi, mult, extra) => uPlot.rangeNum(lo, hi, mult, extra),
    );
    expect(minAbove).toBeLessThanOrEqual(10);
    expect(maxAbove).toBeGreaterThanOrEqual(100);

    const [minBelow, maxBelow] = expandThresholdRange(
      50,
      80,
      5,
      (lo, hi, mult, extra) => uPlot.rangeNum(lo, hi, mult, extra),
    );
    expect(minBelow).toBeLessThanOrEqual(5);
    expect(maxBelow).toBeGreaterThanOrEqual(80);

    const [minNonFinite, maxNonFinite] = expandThresholdRange(
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      85,
      (lo, hi, mult, extra) => uPlot.rangeNum(lo, hi, mult, extra),
    );
    expect(minNonFinite).toBeLessThanOrEqual(0);
    expect(maxNonFinite).toBeGreaterThanOrEqual(85);

    expect(thresholdColor("light", "warning")).toMatch(/^#/u);
    expect(thresholdColor("dark", "error")).toMatch(/^#/u);
  });
});
