import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";
import type {
  ReportQueryResult,
  ReportResultRow,
  ReportResultValue,
} from "#src/reports/query-engine.ts";
import {
  resolveTemporalContext,
  windowRange,
} from "#src/reports/temporal-plan.ts";
import { buildVisualizationSnapshot } from "#src/reports/visualization-snapshot.ts";

const NOW = new Date("2026-08-08T00:00:00.000Z");
const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

function row(input: {
  label: string;
  keys: LakeScalar[];
  values: ReportResultValue[];
}): ReportResultRow {
  return {
    label: input.label,
    dimensions: input.label.split(" • "),
    keys: input.keys,
    mentionIdentity: null,
    values: input.values,
  };
}

function games(value: number, extra: Partial<ReportResultValue> = {}) {
  return { column: "games", value, ...extra };
}

function result(
  plan: ScoutQlPlan,
  rows: ReportResultRow[],
  options: {
    columns?: string[];
    evidence?: ReportQueryResult["evidence"];
    now?: Date;
  } = {},
): ReportQueryResult {
  const range = windowRange(plan.timeWindow, options.now ?? NOW);
  const context = resolveTemporalContext(plan, range);
  return {
    plan,
    columns: options.columns ?? ["label", "games"],
    rows,
    rowsScanned: rows.length,
    range,
    ...(context === null ? {} : { temporal: context }),
    ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
  };
}

function queueRow(queue: string, value: number, comparison: number) {
  return row({
    label: `${queue} • 2026-08-01`,
    keys: [queue, "2026-08-01T00:00:00.000Z"],
    values: [
      games(value, {
        comparisonValue: comparison,
        absoluteDelta: value - comparison,
        percentageDelta: value / comparison - 1,
        comparisonSampleSize: comparison,
        comparisonConfidenceInterval: null,
      }),
    ],
  });
}

function playerRow(player: string, day: string, value: number) {
  return row({
    label: `${player} • ${day}`,
    keys: [player, `${day}T00:00:00.000Z`],
    values: [games(value)],
  });
}

function histogramRow(start: number, value: number) {
  return row({
    label: String(start),
    keys: [start],
    values: [{ column: "bucket", value: start }, games(value)],
  });
}

function boxSummary(champion: string, values: number[]) {
  return row({
    label: champion,
    keys: [champion],
    values: ["low", "q1", "med", "q3", "high"].map((column, index) => ({
      column,
      value: values[index] ?? null,
    })),
  });
}

describe("buildVisualizationSnapshot", () => {
  test("orders patch buckets chronologically before assigning bounds", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games FROM match_participants " +
        "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY " +
        "GROUP BY patch ORDER BY games DESC RENDER line_chart WITH (y = games)",
    );
    const snapshot = buildVisualizationSnapshot(
      result(plan, [
        row({ label: "26.10", keys: ["26.10"], values: [games(10)] }),
        row({ label: "26.9", keys: ["26.9"], values: [games(9)] }),
      ]),
      NOW,
    );
    expect(snapshot.bucket).toBe("patch");
    expect(snapshot.series[0]?.points.map((point) => point.label)).toEqual([
      "26.9",
      "26.10",
    ]);
    expect(snapshot.annotations.map((annotation) => annotation.label)).toEqual([
      "Patch 26.10",
    ]);
  });

  test("caps non-temporal snapshot series without failing a valid table", () => {
    const plan = compileScoutQl(
      `SELECT champion, queue, COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY champion, queue RENDER table`,
    );
    const rows = Array.from({ length: 9 }, (_, index) =>
      row({
        label: `Champion ${index.toString()} • solo`,
        keys: [`Champion ${index.toString()}`, "solo"],
        values: [games(index + 1)],
      }),
    );
    const snapshot = buildVisualizationSnapshot(
      result(plan, rows, { columns: ["label", "champion", "queue", "games"] }),
      NOW,
    );
    expect(snapshot.series).toHaveLength(8);
  });

  test("rejects charts that exceed the plotted series limit", () => {
    const plan = compileScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY champion, queue RENDER donut_chart WITH (y = games)`,
    );
    const rows = Array.from({ length: 9 }, (_, index) =>
      row({
        label: `Champion ${index.toString()} • solo`,
        keys: [`Champion ${index.toString()}`, "solo"],
        values: [games(index + 1)],
      }),
    );
    expect(() => buildVisualizationSnapshot(result(plan, rows), NOW)).toThrow(
      "at most eight series",
    );
  });

  test("rejects projected bucket expansion above the point limit", () => {
    const columns = ["games", "wins", "kills", "deaths", "assists", "cs"];
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games, COUNT(*) FILTER (WHERE win) AS wins, " +
        "SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(assists) AS assists, " +
        "SUM(creep_score) AS cs FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-01-01' AND '2026-12-31' " +
        "GROUP BY DATE_TRUNC('day', game_creation_at) " +
        `RENDER line_chart WITH (y = (${columns.join(", ")}))`,
    );
    expect(() =>
      buildVisualizationSnapshot(
        result(plan, [], { columns: ["label", ...columns] }),
        new Date("2026-12-31T23:59:59.999Z"),
      ),
    ).toThrow("would plot 2190");
  });

  test("archives the complete chart option set", () => {
    const plan = compileScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY champion ` +
        "RENDER bar_chart WITH (y = games, subtitle = 'By champion', " +
        "x_axis = 'Champion', y_axis = 'Games', theme = minimal_light, " +
        "palette = team, colors = (#112233, #abcdef), orientation = horizontal, " +
        "labels = value, legend = none, sort = desc)",
    );
    const snapshot = buildVisualizationSnapshot(result(plan, []), NOW);
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
      sort: "desc",
    });
  });

  test("an unbounded window carries a bucket but no analysis spec", () => {
    const plan = compileScoutQl(
      "SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games " +
        "FROM match_participants GROUP BY DATE_TRUNC('week', game_creation_at) " +
        "RENDER line_chart WITH (y = games)",
    );
    const snapshot = buildVisualizationSnapshot(
      result(plan, [
        row({
          label: "2026-08-03",
          keys: ["2026-08-03T00:00:00.000Z"],
          values: [games(4)],
        }),
      ]),
      NOW,
    );
    expect(snapshot.bucket).toBe("week");
    expect(snapshot.temporal).toBeNull();
    // No window to enumerate, so no buckets are invented back to the epoch.
    expect(snapshot.series[0]?.points).toHaveLength(1);
  });
});

describe("temporal visualization buckets", () => {
  test("fills leading and trailing buckets across the requested window", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-08-01' AND '2026-08-03' " +
        "GROUP BY DATE_TRUNC('day', game_creation_at) " +
        "ORDER BY games DESC RENDER line_chart WITH (y = games)",
    );
    const bucketRow = row({
      label: "2026-08-02",
      keys: ["2026-08-02T00:00:00.000Z"],
      values: [games(2)],
    });
    const snapshot = buildVisualizationSnapshot(
      result(plan, [bucketRow], {
        evidence: [
          {
            label: bucketRow.label,
            values: [{ column: "games", sampleSize: 2 }],
          },
        ],
      }),
      NOW,
    );
    expect(
      snapshot.series[0]?.points.map((point) => [point.label, point.value]),
    ).toEqual([
      ["2026-08-01", 0],
      ["2026-08-02", 2],
      ["2026-08-03", 0],
    ]);
    expect(snapshot.temporal).toMatchObject({
      window: { kind: "calendar", startDate: "2026-08-01" },
      bucket: "day",
    });
  });

  test("zero-fills both sides of missing additive comparison buckets", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-08-01' AND '2026-08-03' " +
        "GROUP BY DATE_TRUNC('day', game_creation_at) ORDER BY games DESC " +
        "RENDER line_chart WITH (y = games, compare = previous_period)",
    );
    const snapshot = buildVisualizationSnapshot(result(plan, []), NOW);
    expect(snapshot.temporal?.comparison).toEqual({ kind: "previous_period" });
    expect(snapshot.series[0]?.points).toEqual(
      ["2026-08-01", "2026-08-02", "2026-08-03"].map((label) =>
        expect.objectContaining({
          label,
          value: 0,
          comparisonValue: 0,
          absoluteDelta: 0,
          percentageDelta: null,
          comparisonEvidence: { sampleSize: 0, confidenceInterval: null },
        }),
      ),
    );
  });

  test("normalizes comparison values and deltas in percentage stacks", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-08-01' AND '2026-08-01' " +
        "GROUP BY queue, DATE_TRUNC('day', game_creation_at) " +
        "RENDER area_chart WITH (y = games, stack = percent, compare = previous_period)",
    );
    const snapshot = buildVisualizationSnapshot(
      result(plan, [queueRow("solo", 60, 30), queueRow("flex", 40, 70)]),
      NOW,
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
    const plan = compileScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} ` +
        "GROUP BY champion, queue " +
        "RENDER heatmap WITH (x = queue, series = champion, value = games)",
    );
    const snapshot = buildVisualizationSnapshot(
      result(plan, [
        row({
          label: "Ahri • solo",
          keys: ["Ahri", "solo"],
          values: [games(3)],
        }),
        row({
          label: "Garen • flex",
          keys: ["Garen", "flex"],
          values: [games(2)],
        }),
      ]),
      NOW,
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
    const plan = compileScoutQl(
      `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} ` +
        "GROUP BY champion, queue " +
        "RENDER bar_chart WITH (x = champion, series = queue, y = games)",
    );
    const snapshot = buildVisualizationSnapshot(
      result(plan, [
        row({
          label: "Ahri • solo",
          keys: ["Ahri", "solo"],
          values: [games(3)],
        }),
        row({
          label: "Garen • flex",
          keys: ["Garen", "flex"],
          values: [games(2)],
        }),
      ]),
      NOW,
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
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-08-01' AND '2026-08-02' " +
        "GROUP BY player, DATE_TRUNC('day', game_creation_at) " +
        "RENDER bump_chart WITH (y = games)",
    );
    const snapshot = buildVisualizationSnapshot(
      result(plan, [
        playerRow("Alpha", "2026-08-01", 8),
        playerRow("Beta", "2026-08-01", 4),
        playerRow("Alpha", "2026-08-02", 3),
        playerRow("Beta", "2026-08-02", 9),
      ]),
      NOW,
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

describe("distribution snapshot shapes the renderer enforces", () => {
  test("HISTOGRAM is one series of ascending, human-labelled buckets", () => {
    const plan = compileScoutQl(
      "SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games " +
        `FROM match_participants WHERE ${BOUND} ` +
        "GROUP BY FLOOR(game_duration_seconds / 300) * 300 RENDER histogram",
    );
    const snapshot = buildVisualizationSnapshot(
      result(
        plan,
        [histogramRow(1200, 1), histogramRow(300, 7), histogramRow(600, 4)],
        {
          columns: ["label", "bucket", "games"],
        },
      ),
      NOW,
    );
    expect(snapshot.series).toHaveLength(1);
    expect(
      snapshot.series[0]?.points.map((point) => [point.label, point.value]),
    ).toEqual([
      ["300–599", 7],
      ["600–899", 4],
      ["1200–1499", 1],
    ]);
  });

  test("BOX_PLOT is five series in encoding order, zipped by point key", () => {
    const plan = compileScoutQl(
      "SELECT MIN(kills) AS low, QUANTILE_CONT(kills, 0.25) AS q1, " +
        "MEDIAN(kills) AS med, QUANTILE_CONT(kills, 0.75) AS q3, MAX(kills) AS high " +
        `FROM match_participants WHERE ${BOUND} GROUP BY champion ` +
        "RENDER box_plot WITH (y = (low, q1, med, q3, high))",
    );
    const snapshot = buildVisualizationSnapshot(
      result(
        plan,
        [
          boxSummary("Ahri", [0, 2, 4, 7, 12]),
          boxSummary("Garen", [1, 3, 5, 8, 14]),
        ],
        { columns: ["label", "low", "q1", "med", "q3", "high"] },
      ),
      NOW,
    );
    expect(snapshot.series).toHaveLength(5);
    expect(snapshot.series.map((series) => series.metric)).toEqual([
      "low",
      "q1",
      "med",
      "q3",
      "high",
    ]);
    expect(
      snapshot.series.map((series) => series.points.map((point) => point.key)),
    ).toEqual(Array.from({ length: 5 }, () => ["Ahri", "Garen"]));
    expect(snapshot.series.map((series) => series.points[0]?.value)).toEqual([
      0, 2, 4, 7, 12,
    ]);
  });
});
