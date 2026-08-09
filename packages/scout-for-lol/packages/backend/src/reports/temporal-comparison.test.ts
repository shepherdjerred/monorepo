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
});
