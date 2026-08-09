import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import { competitionQueryRanges } from "#src/reports/query-engine.ts";

describe("competitionQueryRanges", () => {
  test("clamps query bounds without changing comparison alignment origins", () => {
    const plan = parseAndCompile(
      "SELECT games FROM competition_match_participants GROUP BY all ANALYZE BETWEEN '2026-08-10' AND '2026-08-14' BUCKET BY DAY COMPARE TO BETWEEN '2026-08-01' AND '2026-08-05' IN TIME ZONE 'UTC' RENDER line_chart WITH (y = games)",
    );

    const ranges = competitionQueryRanges(
      {
        startDate: new Date("2026-08-05T00:00:00.000Z"),
        endDate: new Date("2026-08-31T23:59:59.999Z"),
      },
      plan,
      new Date("2026-09-01T00:00:00.000Z"),
      undefined,
    );

    expect(ranges.comparison?.startDate.toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    );
    expect(ranges.alignment.comparison?.startDate.toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    expect(ranges.alignment.current.startDate.toISOString()).toBe(
      "2026-08-10T00:00:00.000Z",
    );
  });
});
