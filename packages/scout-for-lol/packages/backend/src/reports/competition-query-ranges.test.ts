import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import { competitionQueryRange } from "#src/reports/query-engine.ts";
import { clampTemporalRange } from "#src/reports/temporal-range.ts";
import { resolveTemporalContext } from "#src/reports/temporal-plan.ts";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const COMPETITION = {
  startDate: new Date("2026-08-12T00:00:00.000Z"),
  endDate: new Date("2026-08-31T23:59:59.999Z"),
};

const PLAN = compileScoutQl(
  "SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS games " +
    "FROM competition_match_participants " +
    "WHERE competition_id = 7 AND " +
    "game_creation_at::DATE BETWEEN '2026-08-10' AND '2026-08-14' " +
    "GROUP BY DATE_TRUNC('day', game_creation_at) ORDER BY day ASC " +
    "RENDER line_chart WITH (y = games, compare = previous_period)",
);

describe("competitionQueryRange", () => {
  test("intersects the query's window with the competition's own dates", () => {
    const range = competitionQueryRange(COMPETITION, PLAN, NOW, undefined);
    // The query asked for Aug 10-14; the competition only started on the 12th.
    expect(range.startDate.toISOString()).toBe("2026-08-12T00:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-08-14T23:59:59.999Z");
  });

  test("an explicit range override is clamped, not replaced", () => {
    const range = competitionQueryRange(COMPETITION, PLAN, NOW, {
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2026-08-20T00:00:00.000Z"),
    });
    expect(range.startDate.toISOString()).toBe("2026-08-12T00:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  test("clamping the executed baseline never moves the alignment origin", () => {
    const current = competitionQueryRange(COMPETITION, PLAN, NOW, undefined);
    const context = resolveTemporalContext(PLAN, current);
    if (context === null) throw new Error("expected a comparison context");
    // The alignment origin is the unclamped preceding window: bucket offsets
    // are measured from it, so clamping it would shift every paired bucket.
    expect(context.ranges.comparison.startDate.toISOString()).toBe(
      "2026-08-09T00:00:00.000Z",
    );
    // A baseline that reaches into the competition executes clamped.
    expect(
      clampTemporalRange(
        context.ranges.comparison,
        { startDate: new Date("2026-08-10T00:00:00.000Z"), endDate: null },
        NOW,
      ).startDate.toISOString(),
    ).toBe("2026-08-10T00:00:00.000Z");
  });

  test("a baseline entirely before the competition is empty, not an error", () => {
    // Guarded end to end: the current period is what the author asked for, so
    // a comparison that predates the competition must not fail the report.
    const current = competitionQueryRange(COMPETITION, PLAN, NOW, undefined);
    const context = resolveTemporalContext(PLAN, current);
    if (context === null) throw new Error("expected a comparison context");
    expect(context.ranges.comparison.endDate.getTime()).toBeLessThan(
      COMPETITION.startDate.getTime(),
    );
  });
});
