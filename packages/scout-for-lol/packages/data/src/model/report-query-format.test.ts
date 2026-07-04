import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "#src/model/report-query-compile.ts";
import { formatReportQuery } from "#src/model/report-query-format.ts";
import { REPORT_COMMON_PRESETS } from "#src/model/report-query-registry.ts";

describe("formatReportQuery", () => {
  test("formats a valid ScoutQL query by clause", () => {
    expect(
      formatReportQuery(
        "select games, win_rate from match_participants where queue in (solo) and games >= 5 group by player order by win_rate desc limit 10 render bar_chart with (y = win_rate)",
      ),
    ).toBe(
      [
        "SELECT games, win_rate",
        "FROM match_participants",
        "WHERE queue IN (solo)",
        "  AND games >= 5",
        "GROUP BY player",
        "ORDER BY win_rate desc",
        "LIMIT 10",
        "RENDER bar_chart with (y = win_rate)",
      ].join("\n"),
    );
  });

  test("preserves invalid or incomplete input", () => {
    expect(formatReportQuery("select games")).toBe("select games");
  });
});

describe("REPORT_COMMON_PRESETS", () => {
  test("offers a bounded list of common report presets", () => {
    expect(REPORT_COMMON_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(REPORT_COMMON_PRESETS.length).toBeLessThanOrEqual(10);
  });

  test("contains valid report queries", () => {
    const compiled = REPORT_COMMON_PRESETS.map((preset) =>
      parseAndCompile(preset.query),
    );
    expect(compiled).toHaveLength(REPORT_COMMON_PRESETS.length);
  });
});
