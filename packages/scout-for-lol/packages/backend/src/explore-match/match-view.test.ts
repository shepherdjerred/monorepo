import { describe, expect, test } from "vitest";
import { ReportAiPreviewSummarySchema } from "@scout-for-lol/data";
import {
  isExploreMatchSnapshotSupported,
  matchIdsInPreview,
} from "#src/explore-match/match-view.ts";

describe("matchIdsInPreview", () => {
  test("excludes Arena from the classic two-team match snapshot", () => {
    expect(isExploreMatchSnapshotSupported("CHERRY")).toBe(false);
    expect(isExploreMatchSnapshotSupported("CLASSIC")).toBe(true);
  });

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
    expect(matchIdsInPreview(preview, "match_participants")).toEqual(
      new Set(["NA1_5635906026"]),
    );
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
    expect(matchIdsInPreview(preview, "match_participants")).toEqual(new Set());
  });

  test("does not allow cards for lobby-only prematch results", () => {
    const preview = ReportAiPreviewSummarySchema.parse({
      columns: [{ key: "match_id", label: "Match ID", format: "text" }],
      rows: [
        {
          label: "Lobby",
          values: [{ column: "match_id", value: "NA1_5635906026" }],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
      rowsScanned: 1,
      renderKind: "TABLE",
    });

    expect(matchIdsInPreview(preview, "prematch_participants")).toEqual(
      new Set(),
    );
  });
});
