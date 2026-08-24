import { describe, expect, test } from "vitest";
import { parseAndCompile } from "@scout-for-lol/data";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-types.ts";
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
      "SELECT champion, queue, games FROM match_participants GROUP BY champion, queue DURING LAST 30 DAYS RENDER table",
    );
    const rows = Array.from({ length: 9 }, (_, index): ReportResultRow => ({
      label: `Champion ${index.toString()} • solo`,
      dimensions: [`Champion ${index.toString()}`, "solo"],
      mentionIdentity: null,
      values: [{ column: "games", value: index + 1 }],
    }));

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows, rowsScanned: 9 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series).toHaveLength(8);
  });

  test("rejects charts that exceed the plotted series limit", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY champion, queue DURING LAST 30 DAYS RENDER donut_chart WITH (y = games)",
    );
    const rows = Array.from({ length: 9 }, (_, index): ReportResultRow => ({
      label: `Champion ${index.toString()} • solo`,
      dimensions: [`Champion ${index.toString()}`, "solo"],
      mentionIdentity: null,
      values: [{ column: "games", value: index + 1 }],
    }));

    expect(() =>
      buildVisualizationSnapshot(
        { plan, columns: ["label", "games"], rows, rowsScanned: 9 },
        new Date("2026-08-08T00:00:00.000Z"),
      ),
    ).toThrow("at most eight series");
  });

  test("rejects projected bucket expansion above the point limit", () => {
    const plan = parseAndCompile(
      "SELECT games, wins, kills, deaths, assists, creep_score FROM match_participants GROUP BY all ANALYZE BETWEEN '2026-01-01' AND '2026-12-31' BUCKET BY DAY IN TIME ZONE 'UTC' ORDER BY label ASC RENDER line_chart WITH (y = (games, wins, kills, deaths, assists, creep_score))",
    );

    expect(() =>
      buildVisualizationSnapshot(
        {
          plan,
          columns: [
            "label",
            "games",
            "wins",
            "kills",
            "deaths",
            "assists",
            "creep_score",
          ],
          rows: [],
          rowsScanned: 0,
        },
        new Date("2026-12-31T23:59:59.999Z"),
      ),
    ).toThrow("would plot 2190");
  });

  test("archives the complete chart option set", () => {
    const plan = parseAndCompile(
      'SELECT games FROM match_participants GROUP BY champion DURING LAST 30 DAYS RENDER bar_chart WITH (y = games, subtitle = "By champion", x_axis = "Champion", y_axis = "Games", theme = minimal_light, palette = team, colors = (#112233, #abcdef), orientation = horizontal, labels = value, legend = none, sort = asc)',
    );

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows: [], rowsScanned: 0 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.display.options).toEqual({
      subtitle: "By champion",
      xAxisLabel: "Champion",
      yAxisLabel: "Games",
      theme: "minimal_light",
      palette: "team",
      colors: ["#112233", "#abcdef"],
      orientation: "horizontal",
      labels: "value",
      legend: "none",
      sort: "asc",
    });
  });
});

describe("temporal visualization buckets", () => {
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

  test("zero-fills both sides of missing additive comparison buckets", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY all ANALYZE BETWEEN '2026-08-01' AND '2026-08-03' BUCKET BY DAY COMPARE TO BETWEEN '2026-07-29' AND '2026-07-31' IN TIME ZONE 'UTC' ORDER BY label ASC RENDER line_chart WITH (y = games)",
    );

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows: [], rowsScanned: 0 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series[0]?.points).toEqual(
      ["2026-08-01", "2026-08-02", "2026-08-03"].map((label) =>
        expect.objectContaining({
          label,
          value: 0,
          comparisonValue: 0,
          absoluteDelta: 0,
          percentageDelta: null,
          comparisonEvidence: {
            sampleSize: 0,
            confidenceInterval: null,
          },
        }),
      ),
    );
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
      "SELECT games FROM match_participants GROUP BY champion, queue DURING LAST 30 DAYS RENDER heatmap WITH (x = queue, series = champion, value = games)",
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

  test("applies x and series encodings to categorical snapshots", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY champion, queue DURING LAST 30 DAYS RENDER bar_chart WITH (x = champion, series = queue, y = games)",
    );
    const rows: ReportResultRow[] = [
      categoricalRow("Ahri", "solo", 3),
      categoricalRow("Garen", "flex", 2),
    ];

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows, rowsScanned: 5 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series.map((series) => series.label)).toEqual([
      "solo — games",
      "flex — games",
    ]);
    expect(snapshot.series.map((series) => series.points[0]?.label)).toEqual([
      "Ahri",
      "Garen",
    ]);
  });

  test("ranks bump chart values within each temporal bucket", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY player ANALYZE BETWEEN '2026-08-01' AND '2026-08-02' BUCKET BY DAY RENDER bump_chart WITH (y = games)",
    );
    const rows: ReportResultRow[] = [
      temporalPlayerRow("Alpha", "2026-08-01", 8),
      temporalPlayerRow("Beta", "2026-08-01", 4),
      temporalPlayerRow("Alpha", "2026-08-02", 3),
      temporalPlayerRow("Beta", "2026-08-02", 9),
    ];

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows, rowsScanned: 24 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(
      snapshot.series
        .find((series) => series.label.startsWith("Alpha"))
        ?.points.map((point) => point.value),
    ).toEqual([1, 2]);
    expect(
      snapshot.series
        .find((series) => series.label.startsWith("Beta"))
        ?.points.map((point) => point.value),
    ).toEqual([2, 1]);
  });
});

function categoricalRow(
  champion: string,
  queue: string,
  games: number,
): ReportResultRow {
  return {
    label: `${champion} • ${queue}`,
    dimensions: [champion, queue],
    mentionIdentity: null,
    values: [{ column: "games", value: games }],
  };
}

function temporalPlayerRow(
  player: string,
  day: string,
  games: number,
): ReportResultRow {
  return {
    label: `${player} • ${day}`,
    dimensions: [player, day],
    mentionIdentity: null,
    values: [{ column: "games", value: games }],
  };
}

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
