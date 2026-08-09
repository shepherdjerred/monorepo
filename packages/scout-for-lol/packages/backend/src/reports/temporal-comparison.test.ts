import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import type { ReportResultRow } from "#src/reports/query-engine.ts";
import { attachTemporalComparison } from "#src/reports/temporal-comparison.ts";

function row(patch: string, games: number): ReportResultRow {
  return {
    label: patch,
    dimensions: [patch],
    mentionIdentity: null,
    values: [{ column: "games", value: games }],
  };
}

describe("attachTemporalComparison", () => {
  test("aligns patch buckets using numeric patch chronology", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY all ANALYZE LAST 90 DAYS BUCKET BY PATCH COMPARE TO PREVIOUS PERIOD IN TIME ZONE 'UTC' ORDER BY games DESC RENDER line_chart WITH (y = games)",
    );
    const currentRows = [row("26.10", 20), row("26.9", 10)];
    const comparisonRows = [row("25.10", 2), row("25.9", 1)];

    const result = attachTemporalComparison({
      currentRows,
      comparisonRows,
      comparisonEvidence: comparisonRows.map((baselineRow) => ({
        label: baselineRow.label,
        values: [{ column: "games", sampleSize: 1 }],
      })),
      plan,
      ranges: {
        current: {
          startDate: new Date("2026-05-01T00:00:00.000Z"),
          endDate: new Date("2026-07-29T23:59:59.999Z"),
        },
        comparison: {
          startDate: new Date("2026-01-31T00:00:00.000Z"),
          endDate: new Date("2026-04-30T23:59:59.999Z"),
        },
      },
    });

    expect(result.rows[0]?.values[0]?.comparisonValue).toBe(2);
    expect(result.rows[1]?.values[0]?.comparisonValue).toBe(1);
  });

  test("materializes a zero current row for a comparison-only bucket", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY all ANALYZE BETWEEN '2026-05-02' AND '2026-05-02' BUCKET BY DAY COMPARE TO BETWEEN '2026-05-01' AND '2026-05-01' IN TIME ZONE 'UTC' RENDER line_chart WITH (y = games)",
    );
    const baseline = row("2026-05-01", 5);
    const result = attachTemporalComparison({
      currentRows: [],
      comparisonRows: [baseline],
      comparisonEvidence: [
        {
          label: baseline.label,
          values: [{ column: "games", sampleSize: 5 }],
        },
      ],
      plan,
      ranges: {
        current: {
          startDate: new Date("2026-05-02T00:00:00.000Z"),
          endDate: new Date("2026-05-02T23:59:59.999Z"),
        },
        comparison: {
          startDate: new Date("2026-05-01T00:00:00.000Z"),
          endDate: new Date("2026-05-01T23:59:59.999Z"),
        },
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.dimensions).toEqual(["2026-05-02"]);
    expect(result.rows[0]?.values[0]).toMatchObject({
      value: 0,
      comparisonValue: 5,
      absoluteDelta: -5,
      percentageDelta: -1,
      comparisonSampleSize: 5,
    });
  });

  test("aligns sparse patch series against period-wide patch positions", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY player ANALYZE LAST 90 DAYS BUCKET BY PATCH COMPARE TO PREVIOUS PERIOD IN TIME ZONE 'UTC' RENDER line_chart WITH (y = games)",
    );
    const currentRows = [
      groupedRow("Alpha", "26.10", 10),
      groupedRow("Beta", "26.9", 20),
    ];
    const comparisonRows = [
      groupedRow("Alpha", "25.9", 1),
      groupedRow("Beta", "25.10", 2),
    ];

    const result = attachTemporalComparison({
      currentRows,
      comparisonRows,
      comparisonEvidence: comparisonRows.map((baselineRow) => ({
        label: baselineRow.label,
        values: [{ column: "games", sampleSize: 1 }],
      })),
      plan,
      ranges: {
        current: {
          startDate: new Date("2026-05-01T00:00:00.000Z"),
          endDate: new Date("2026-07-29T23:59:59.999Z"),
        },
        comparison: {
          startDate: new Date("2026-01-31T00:00:00.000Z"),
          endDate: new Date("2026-04-30T23:59:59.999Z"),
        },
      },
    });

    const alpha = result.rows.filter((item) => item.dimensions[0] === "Alpha");
    expect(alpha.map((item) => item.dimensions[1])).toEqual(["26.10", "26.9"]);
    expect(alpha[0]?.values[0]).toMatchObject({
      value: 10,
      comparisonValue: 0,
    });
    expect(alpha[1]?.values[0]).toMatchObject({
      value: 0,
      comparisonValue: 1,
    });
  });
});

function groupedRow(
  player: string,
  patch: string,
  games: number,
): ReportResultRow {
  return {
    label: `${player} • ${patch}`,
    dimensions: [player, patch],
    mentionIdentity: null,
    values: [{ column: "games", value: games }],
  };
}
