import { describe, expect, test } from "bun:test";
import type { TemporalSeries } from "@scout-for-lol/data";
import { normalizePercentStack } from "#src/reports/visualization-series-transforms.ts";

describe("normalizePercentStack", () => {
  test("clears confidence intervals after changing values to shares", () => {
    const series: TemporalSeries[] = [
      normalizedSeries("wins", 3, 2),
      normalizedSeries("losses", 1, 2),
    ];

    const normalized = normalizePercentStack(series);

    expect(normalized[0]?.points[0]).toMatchObject({
      value: 0.75,
      comparisonValue: 0.5,
      evidence: { sampleSize: 4, confidenceInterval: null },
      comparisonEvidence: { sampleSize: 4, confidenceInterval: null },
    });
  });
});

function normalizedSeries(
  id: string,
  value: number,
  comparisonValue: number,
): TemporalSeries {
  return {
    id,
    label: id,
    metric: "win_rate",
    additive: false,
    points: [
      {
        key: "2026-08-08",
        label: "2026-08-08",
        start: "2026-08-08T00:00:00.000Z",
        end: "2026-08-08T23:59:59.999Z",
        value,
        comparisonValue,
        absoluteDelta: value - comparisonValue,
        percentageDelta: value / comparisonValue - 1,
        evidence: {
          sampleSize: 4,
          confidenceInterval: { level: 0.95, lower: 0.1, upper: 0.9 },
        },
        comparisonEvidence: {
          sampleSize: 4,
          confidenceInterval: { level: 0.95, lower: 0.1, upper: 0.9 },
        },
      },
    ],
  };
}
