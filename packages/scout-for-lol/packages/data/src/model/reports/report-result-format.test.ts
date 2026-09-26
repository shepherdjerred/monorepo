import { describe, expect, test } from "vitest";
import type { ReportResultColumn } from "#src/model/reports/report-ai.ts";
import { reportAssetInfo } from "#src/model/reports/report-assets.ts";
import { formatReportDisplayValue } from "#src/model/reports/report-result-format.ts";

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
  const rune: ReportResultColumn = {
    key: "perk0",
    label: "Keystone",
    format: "text",
    asset: "rune",
  };
  const item: ReportResultColumn = {
    key: "item0",
    label: "Item",
    format: "text",
    asset: "item",
  };
  const spell: ReportResultColumn = {
    key: "summoner1_id",
    label: "Summoner 1",
    format: "text",
    asset: "spell",
  };

  test("formats rates, counts, and ratios semantically", () => {
    expect(formatReportDisplayValue(games, 1276)).toBe("1,276");
    expect(formatReportDisplayValue(winRate, 0.54296875)).toBe("54.3%");
    expect(formatReportDisplayValue(kda, 3.456)).toBe("3.46");
  });

  test("passes dimension text through untouched", () => {
    expect(formatReportDisplayValue(label, "Long")).toBe("Long");
  });

  test("asset ids and names format as display names for text exports", () => {
    expect(formatReportDisplayValue(rune, 8010)).toBe("Conqueror");
    expect(formatReportDisplayValue(item, 3031)).toBe("Infinity Edge");
    expect(formatReportDisplayValue(spell, 4)).toBe("Flash");
    expect(formatReportDisplayValue(rune, "Conqueror")).toBe("Conqueror");
    expect(formatReportDisplayValue(item, 0)).toBe("Empty");
    expect(reportAssetInfo("rune_tree", 8000)).toEqual({
      canonicalKey: ["7201", "Precision"].join("_"),
      name: "Precision",
    });
    expect(reportAssetInfo("champion", 62)).toEqual({
      canonicalKey: "MonkeyKing",
      name: "Wukong",
    });
  });
});
