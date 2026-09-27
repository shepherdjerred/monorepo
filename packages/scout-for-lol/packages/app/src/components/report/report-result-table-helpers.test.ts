import { describe, expect, test } from "vitest";
import type { ReportResultColumn } from "@scout-for-lol/data";
import {
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

describe("asset-backed report labels", () => {
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
