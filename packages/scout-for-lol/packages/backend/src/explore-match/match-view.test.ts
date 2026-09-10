import { describe, expect, test } from "vitest";
import { ReportAiPreviewSummarySchema } from "@scout-for-lol/data";
import { matchIdsInPreview } from "#src/explore-match/match-view.ts";

describe("matchIdsInPreview", () => {
  test("allows cards only for match ids a query actually returned", () => {
    const preview = ReportAiPreviewSummarySchema.parse({
      columns: [
        { key: "label", label: "Match ID", format: "text" },
        { key: "total_kills", label: "Total kills", format: "integer" },
      ],
      rows: [
        {
          label: "NA1_5635906026",
          values: [{ column: "total_kills", value: 179 }],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
      rowsScanned: 10,
      renderKind: "TABLE",
    });
    expect(matchIdsInPreview(preview)).toEqual(new Set(["NA1_5635906026"]));
  });

  test("does not treat arbitrary answer labels as card-eligible matches", () => {
    const preview = ReportAiPreviewSummarySchema.parse({
      columns: [{ key: "label", label: "Champion", format: "text" }],
      rows: [{ label: "NA1_5635906026", values: [] }],
      visualizationRows: [],
      rowsReturned: 1,
      rowsScanned: 10,
      renderKind: "TABLE",
    });
    expect(matchIdsInPreview(preview)).toEqual(new Set());
  });
});
