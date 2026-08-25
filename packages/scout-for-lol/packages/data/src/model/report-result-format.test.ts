import { describe, expect, test } from "vitest";
import type { ReportResultColumn } from "#src/model/report-ai.ts";
import { formatReportDisplayValue } from "#src/model/report-result-format.ts";

describe("report result formatting", () => {
  const label: ReportResultColumn = {
    key: "label",
    label: "Player",
    format: "text",
  };
  const games: ReportResultColumn = {
    key: "games",
    label: "Games",
    format: "integer",
  };
  const winRate: ReportResultColumn = {
    key: "win_rate",
    label: "Win rate",
    format: "percent",
  };
  const kda: ReportResultColumn = {
    key: "kda",
    label: "KDA",
    format: "decimal",
  };

  test("formats rates, counts, and ratios semantically", () => {
    expect(formatReportDisplayValue(games, 1276)).toBe("1,276");
    expect(formatReportDisplayValue(winRate, 0.54296875)).toBe("54.3%");
    expect(formatReportDisplayValue(kda, 3.456)).toBe("3.46");
  });

  test("passes dimension text through untouched", () => {
    expect(formatReportDisplayValue(label, "Long")).toBe("Long");
  });
});
