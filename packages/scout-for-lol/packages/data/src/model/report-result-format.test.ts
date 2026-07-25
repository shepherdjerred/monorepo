import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "#src/model/report-query-compile.ts";
import {
  formatReportDisplayValue,
  reportResultColumns,
} from "#src/model/report-result-format.ts";

describe("report result formatting", () => {
  const plan = parseAndCompile(
    "SELECT games, win_rate, kda FROM match_participants GROUP BY player LIMIT 10",
  );
  const columns = reportResultColumns(plan, [
    "label",
    "games",
    "win_rate",
    "kda",
  ]);

  test("builds one friendly definition per result column", () => {
    expect(columns).toEqual([
      { key: "label", label: "Player", format: "text" },
      { key: "games", label: "Games", format: "integer" },
      { key: "win_rate", label: "Win rate", format: "percent" },
      { key: "kda", label: "KDA", format: "decimal" },
    ]);
  });

  test("formats rates, counts, and ratios semantically", () => {
    const games = columns[1];
    const winRate = columns[2];
    const kda = columns[3];
    expect(games).toBeDefined();
    expect(winRate).toBeDefined();
    expect(kda).toBeDefined();
    if (games === undefined || winRate === undefined || kda === undefined) {
      throw new Error("Missing result column fixture");
    }
    expect(formatReportDisplayValue(games, 1276)).toBe("1,276");
    expect(formatReportDisplayValue(winRate, 0.542_968_75)).toBe("54.3%");
    expect(formatReportDisplayValue(kda, 3.456)).toBe("3.46");
  });
});
