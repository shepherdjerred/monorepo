import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";
import { buildVisualizationSnapshot } from "#src/reports/visualization-snapshot.ts";

describe("buildVisualizationSnapshot", () => {
  test("orders numeric patch buckets chronologically before assigning bounds", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY all ANALYZE LAST 90 DAYS BUCKET BY PATCH IN TIME ZONE 'UTC' ORDER BY games DESC RENDER line_chart WITH (y = games)",
    );
    const result: ReportQueryResult = {
      plan,
      columns: ["label", "games"],
      rows: [patchRow("26.10", 10), patchRow("26.9", 9)],
      rowsScanned: 19,
    };

    const snapshot = buildVisualizationSnapshot(
      result,
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series[0]?.points.map((point) => point.label)).toEqual([
      "26.9",
      "26.10",
    ]);
    expect(snapshot.annotations.map((annotation) => annotation.label)).toEqual([
      "Patch 26.10",
    ]);
  });

  test("caps non-temporal snapshot series without failing a valid table", () => {
    const plan = parseAndCompile(
      "SELECT champion, queue, games FROM match_participants GROUP BY champion, queue RENDER table",
    );
    const rows = Array.from(
      { length: 9 },
      (_, index): ReportResultRow => ({
        label: `Champion ${index.toString()} • solo`,
        dimensions: [`Champion ${index.toString()}`, "solo"],
        mentionIdentity: null,
        values: [{ column: "games", value: index + 1 }],
      }),
    );

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows, rowsScanned: 9 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series).toHaveLength(8);
  });

  test("fills leading and trailing buckets across the requested window", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY all ANALYZE BETWEEN '2026-08-01' AND '2026-08-03' BUCKET BY DAY IN TIME ZONE 'UTC' ORDER BY games DESC RENDER line_chart WITH (y = games)",
    );
    const row: ReportResultRow = {
      label: "2026-08-02",
      dimensions: ["2026-08-02"],
      mentionIdentity: null,
      values: [{ column: "games", value: 2 }],
    };

    const snapshot = buildVisualizationSnapshot(
      {
        plan,
        columns: ["label", "games"],
        rows: [row],
        rowsScanned: 2,
        evidence: [
          {
            label: row.label,
            values: [{ column: "games", sampleSize: 2 }],
          },
        ],
      },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(
      snapshot.series[0]?.points.map((point) => [point.label, point.value]),
    ).toEqual([
      ["2026-08-01", 0],
      ["2026-08-02", 2],
      ["2026-08-03", 0],
    ]);
  });

  test("normalizes comparison values and deltas in percentage stacks", () => {
    const plan = parseAndCompile(
      "SELECT queue, games FROM match_participants GROUP BY queue ANALYZE BETWEEN '2026-08-01' AND '2026-08-01' BUCKET BY DAY COMPARE TO BETWEEN '2026-07-31' AND '2026-07-31' IN TIME ZONE 'UTC' RENDER area_chart WITH (y = games, stack = percent)",
    );
    const rows: ReportResultRow[] = [
      comparisonRow("solo", 60, 30),
      comparisonRow("flex", 40, 70),
    ];

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows, rowsScanned: 200 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    const solo = snapshot.series.find((series) =>
      series.label.includes("solo"),
    );
    const flex = snapshot.series.find((series) =>
      series.label.includes("flex"),
    );
    expect(solo?.points[0]?.value).toBeCloseTo(0.6);
    expect(solo?.points[0]?.comparisonValue).toBeCloseTo(0.3);
    expect(solo?.points[0]?.absoluteDelta).toBeCloseTo(0.3);
    expect(solo?.points[0]?.percentageDelta).toBeCloseTo(1);
    expect(flex?.points[0]?.value).toBeCloseTo(0.4);
    expect(flex?.points[0]?.comparisonValue).toBeCloseTo(0.7);
    expect(flex?.points[0]?.absoluteDelta).toBeCloseTo(-0.3);
  });

  test("orients heatmap snapshots using the configured dimensions", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY champion, queue RENDER heatmap WITH (x = queue, series = champion, value = games)",
    );
    const rows: ReportResultRow[] = [
      {
        label: "Ahri • solo",
        dimensions: ["Ahri", "solo"],
        mentionIdentity: null,
        values: [{ column: "games", value: 3 }],
      },
      {
        label: "Garen • flex",
        dimensions: ["Garen", "flex"],
        mentionIdentity: null,
        values: [{ column: "games", value: 2 }],
      },
    ];

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows, rowsScanned: 5 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series.map((series) => series.label)).toEqual([
      "solo",
      "flex",
    ]);
    expect(snapshot.series.map((series) => series.points[0]?.label)).toEqual([
      "Ahri",
      "Garen",
    ]);
  });
});

function patchRow(label: string, games: number): ReportResultRow {
  return {
    label,
    dimensions: [label],
    mentionIdentity: null,
    values: [{ column: "games", value: games }],
  };
}

function comparisonRow(
  queue: string,
  games: number,
  comparisonGames: number,
): ReportResultRow {
  return {
    label: `${queue} • 2026-08-01`,
    dimensions: [queue, "2026-08-01"],
    mentionIdentity: null,
    values: [
      {
        column: "games",
        value: games,
        comparisonValue: comparisonGames,
        absoluteDelta: games - comparisonGames,
        percentageDelta: games / comparisonGames - 1,
        comparisonSampleSize: comparisonGames,
        comparisonConfidenceInterval: null,
      },
    ],
  };
}
