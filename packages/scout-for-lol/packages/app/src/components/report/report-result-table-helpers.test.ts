import { describe, expect, test } from "vitest";
import type { ReportResultColumn } from "@scout-for-lol/data";
import {
  formatCell,
  reportRowForFollowUp,
  reportRowSortValue,
  type PreviewRow,
} from "#src/components/report/report-result-table-helpers.tsx";

const championColumn: ReportResultColumn = {
  key: "label",
  label: "Champion",
  format: "text",
  asset: "champion",
};
const championIdColumn: ReportResultColumn = {
  key: "champion_id",
  label: "Champion",
  format: "integer",
  asset: "champion",
};

describe("asset-backed report labels", () => {
  test("suppresses numeric comparisons for asset-backed identifiers", () => {
    const row: PreviewRow = {
      label: "Lux",
      values: [
        {
          column: "champion_id",
          value: 99,
          comparisonValue: 99,
          absoluteDelta: 0,
          percentageDelta: 0,
        },
      ],
    };

    expect(formatCell(championIdColumn, row, undefined, false)).toBe("Lux");
  });

  test("passes the display name to follow-up prompts", () => {
    const row: PreviewRow = { label: "62", values: [] };

    expect(reportRowForFollowUp([championColumn], row).label).toBe("Wukong");
    expect(row.label).toBe("62");
  });

  test("sorts labels by display name instead of numeric asset ID", () => {
    const rows: PreviewRow[] = [
      { label: "62", values: [] },
      { label: "64", values: [] },
    ];
    const sorted = rows.toSorted((left, right) =>
      String(
        reportRowSortValue(championColumn, left, undefined, false),
      ).localeCompare(
        String(reportRowSortValue(championColumn, right, undefined, false)),
      ),
    );

    expect(sorted.map((row) => row.label)).toEqual(["64", "62"]);
  });
});
