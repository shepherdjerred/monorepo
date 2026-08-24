import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";
import type { PlanAggregateRow } from "#src/reports/plan-rows.ts";
import { resultFromPlanRows } from "#src/reports/query-aggregates.ts";
import { mergeTemporalPeriods } from "#src/reports/temporal-comparison.ts";
import type { TemporalContext } from "#src/reports/temporal-plan.ts";

/**
 * Period-over-period alignment. The two periods are matched by BUCKET OFFSET
 * from each range's own start, read off the typed grouping keys — the labels
 * of two different periods never match as text.
 */

const CURRENT = {
  startDate: new Date("2026-05-01T00:00:00.000Z"),
  endDate: new Date("2026-07-29T23:59:59.999Z"),
};
const COMPARISON = {
  startDate: new Date("2026-01-31T00:00:00.000Z"),
  endDate: new Date("2026-04-30T23:59:59.999Z"),
};

function patchPlan(groupBy: string): ScoutQlPlan {
  return compileScoutQl(
    "SELECT COUNT(*) AS games FROM match_participants " +
      "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY " +
      `GROUP BY ${groupBy} RENDER line_chart WITH (y = games, compare = previous_period)`,
  );
}

function planRow(
  label: string,
  keys: LakeScalar[],
  games: number,
): PlanAggregateRow {
  return {
    label,
    playerId: null,
    discordId: null,
    keys,
    groupMembers: null,
    outputs: [
      {
        name: "games",
        value: games,
        evidence: { kind: "sample", sampleCount: games },
      },
    ],
  };
}

function context(overrides: Partial<TemporalContext> = {}): TemporalContext {
  return {
    bucket: "patch",
    groupingIndex: 0,
    timezone: "UTC",
    ranges: { current: CURRENT, comparison: COMPARISON },
    comparison: "previous_period",
    ...overrides,
  };
}

function compared(
  plan: ScoutQlPlan,
  merged: ReturnType<typeof mergeTemporalPeriods>,
) {
  return resultFromPlanRows({
    plan,
    rows: merged,
    rowsScanned: 0,
    range: CURRENT,
    temporal: context(),
  }).rows;
}

describe("mergeTemporalPeriods", () => {
  test("aligns patch buckets using numeric patch chronology", () => {
    const plan = patchPlan("patch");
    const merged = mergeTemporalPeriods({
      plan,
      context: context(),
      current: [planRow("26.10", ["26.10"], 20), planRow("26.9", ["26.9"], 10)],
      comparison: [
        planRow("25.10", ["25.10"], 2),
        planRow("25.9", ["25.9"], 1),
      ],
    });
    const rows = compared(plan, merged);
    const byLabel = new Map(rows.map((row) => [row.label, row]));
    // 26.9 is the period's first patch, so it pairs with 25.9.
    expect(byLabel.get("26.9")?.values[0]?.comparisonValue).toBe(1);
    expect(byLabel.get("26.10")?.values[0]?.comparisonValue).toBe(2);
  });

  test("materializes a zero current row for a comparison-only bucket", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-05-02' AND '2026-05-02' " +
        "GROUP BY DATE_TRUNC('day', game_creation_at) " +
        "RENDER line_chart WITH (y = games, compare = previous_period)",
    );
    const dayContext = context({
      bucket: "day",
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
    const merged = mergeTemporalPeriods({
      plan,
      context: dayContext,
      current: [],
      comparison: [planRow("2026-05-01", ["2026-05-01T00:00:00.000Z"], 5)],
    });
    const rows = resultFromPlanRows({
      plan,
      rows: merged,
      rowsScanned: 0,
      range: dayContext.ranges.current,
      temporal: dayContext,
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("2026-05-02");
    expect(rows[0]?.values[0]).toMatchObject({
      value: 0,
      comparisonValue: 5,
      absoluteDelta: -5,
      percentageDelta: -1,
      comparisonSampleSize: 5,
    });
  });

  test("aligns sparse patch series against period-wide patch positions", () => {
    const plan = patchPlan("player, patch");
    const merged = mergeTemporalPeriods({
      plan,
      context: context({ groupingIndex: 1 }),
      current: [
        planRow("Alpha • 26.10", ["Alpha", "26.10"], 10),
        planRow("Beta • 26.9", ["Beta", "26.9"], 20),
      ],
      comparison: [
        planRow("Alpha • 25.9", ["Alpha", "25.9"], 1),
        planRow("Beta • 25.10", ["Beta", "25.10"], 2),
      ],
    });
    const rows = compared(plan, merged).filter((row) =>
      row.label.startsWith("Alpha"),
    );
    const byLabel = new Map(rows.map((row) => [row.label, row]));
    expect([...byLabel.keys()].toSorted()).toEqual([
      "Alpha • 26.10",
      "Alpha • 26.9",
    ]);
    // Alpha played on the period's second patch only; its own baseline sits at
    // the first offset, so the first current bucket is materialized empty.
    expect(byLabel.get("Alpha • 26.10")?.values[0]).toMatchObject({
      value: 10,
      comparisonValue: 0,
    });
    expect(byLabel.get("Alpha • 26.9")?.values[0]).toMatchObject({
      value: 0,
      comparisonValue: 1,
    });
  });
});
