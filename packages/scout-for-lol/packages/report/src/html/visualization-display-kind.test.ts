import { describe, expect, test } from "vitest";
import { VisualizationSnapshotSchema } from "@scout-for-lol/data";
import { visualizationSnapshotToOption } from "#src/html/visualization-snapshot-option.ts";
import {
  formatDuration,
  formatSeriesValue,
} from "#src/html/visualization-value-format.ts";

/**
 * How a value is formatted must follow what it IS, not what the author named
 * it. Under ScoutQL v1 `series.metric` was a member of a closed enum, so the
 * renderer could look its kind up in the metric registry; v2 output names are
 * arbitrary aliases, so snapshots carry `displayKind` and the registry lookup
 * survives only as a frozen table for snapshots already on disk.
 */
function snapshot(input: {
  kind: string;
  displayKind?: string;
  metric: string;
  value: number;
  absoluteDelta?: number | null;
  percentageDelta?: number | null;
}) {
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: "2026-08-24T00:00:00.000Z",
    kind: input.kind,
    title: null,
    temporal: null,
    bucket: null,
    display: {
      theme: null,
      palette: null,
      smooth: false,
      stack: "none",
      rollingWindow: null,
      cumulative: false,
      sparkline: false,
    },
    series: [
      {
        id: `all:${input.metric}`,
        label: input.metric,
        metric: input.metric,
        ...(input.displayKind === undefined
          ? {}
          : { displayKind: input.displayKind }),
        additive: false,
        points: [
          {
            key: "all",
            label: "All",
            start: "2026-08-01T00:00:00.000Z",
            end: "2026-08-24T00:00:00.000Z",
            value: input.value,
            comparisonValue: null,
            absoluteDelta: input.absoluteDelta ?? null,
            percentageDelta: input.percentageDelta ?? null,
            evidence: { sampleSize: 10, confidenceInterval: null },
          },
        ],
      },
    ],
    annotations: [],
    trends: [],
  });
}

describe("series formatting follows the display kind", () => {
  test("a rate formats as a percent whatever the author aliased it", () => {
    // The bug this pins: under the old registry lookup, `AVG(win::INT) AS r`
    // rendered 0.6 while the identical query aliased `win_rate` rendered 60%.
    const aliased = snapshot({
      kind: "BAR_CHART",
      displayKind: "percent",
      metric: "r",
      value: 0.6,
    });
    const [series] = aliased.series;
    expect(series).toBeDefined();
    if (series === undefined) return;
    expect(formatSeriesValue(aliased, series, 0.6)).toBe("60.0%");
  });

  test("a duration formats as time, not raw seconds", () => {
    const durations = snapshot({
      kind: "BAR_CHART",
      displayKind: "duration",
      metric: "avg_length",
      value: 1709,
    });
    const [series] = durations.series;
    expect(series).toBeDefined();
    if (series === undefined) return;
    expect(formatSeriesValue(durations, series, 1709)).toBe("28:29");
  });

  test("formatDuration covers hours, zero and null", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(null)).toBe("Unknown");
  });

  test("a pre-v2 snapshot still formats its known rate metrics", () => {
    // Stored snapshots carry no display kind; Explore shares and run history
    // must keep rendering as they did.
    const legacy = snapshot({
      kind: "BAR_CHART",
      metric: "win_rate",
      value: 0.55,
    });
    const [series] = legacy.series;
    expect(series).toBeDefined();
    if (series === undefined) return;
    expect(formatSeriesValue(legacy, series, 0.55)).toBe("55.0%");
  });
});

describe("KPI cards without a comparison", () => {
  test("render no delta line rather than 'Δ Unknown · Unknown'", () => {
    // The backend writes null, not undefined, when a query has no
    // `compare = previous_period`.
    const option = visualizationSnapshotToOption(
      snapshot({
        kind: "KPI_CARD",
        displayKind: "count",
        metric: "games",
        value: 42,
        absoluteDelta: null,
      }),
      "static",
    );
    const texts = JSON.stringify(option.graphic ?? []);
    expect(texts).not.toContain("Unknown");
    expect(texts).toContain("42");
  });

  test("still render the delta when a comparison produced one", () => {
    const option = visualizationSnapshotToOption(
      snapshot({
        kind: "KPI_CARD",
        displayKind: "count",
        metric: "games",
        value: 42,
        absoluteDelta: 7,
        percentageDelta: 0.2,
      }),
      "static",
    );
    expect(JSON.stringify(option.graphic ?? [])).toContain("Δ");
  });
});
