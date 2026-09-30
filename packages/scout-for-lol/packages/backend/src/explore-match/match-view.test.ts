import { describe, expect, test } from "vitest";
import {
  ExploreMatchCardRequestSchema,
  ReportAiPreviewSummarySchema,
} from "@scout-for-lol/data";
import {
  assertEligibleExploreMatchCardRequests,
  inferFrameTeamId,
  isExploreMatchSnapshotSupported,
  matchIdsInPreview,
  normalizeRiotIdPart,
  supportedExploreMatchIds,
} from "#src/explore-match/match-view.ts";

describe("matchIdsInPreview", () => {
  test("normalizes empty Riot ID parts to their snapshot null representation", () => {
    expect(normalizeRiotIdPart("")).toBeNull();
    expect(normalizeRiotIdPart("NA1")).toBe("NA1");
    expect(normalizeRiotIdPart(null)).toBeNull();
  });

  test("excludes Arena from the classic two-team match snapshot", () => {
    expect(isExploreMatchSnapshotSupported(0, "CHERRY")).toBe(false);
    expect(isExploreMatchSnapshotSupported(1700, "UNKNOWN")).toBe(false);
    expect(isExploreMatchSnapshotSupported(1740, "UNKNOWN")).toBe(false);
    expect(isExploreMatchSnapshotSupported(1750, "UNKNOWN")).toBe(false);
    expect(isExploreMatchSnapshotSupported(420, "CLASSIC")).toBe(true);
  });

  test("excludes Classic asset modes until their roster is normalized", () => {
    expect(isExploreMatchSnapshotSupported(4310, "JADE")).toBe(false);
    expect(isExploreMatchSnapshotSupported(2450, "KIWI_JADE")).toBe(false);
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

  test("excludes Arena ids before exposing card choices to the model", async () => {
    const supported = await supportedExploreMatchIds({
      matchIds: new Set(["NA1_5635906026", "NA1_5635906027"]),
      lookup: async (matchId) => [
        {
          queue_id: matchId === "NA1_5635906026" ? 1700 : 420,
          game_mode: "CLASSIC",
        },
      ],
    });

    expect(supported).toEqual(new Set(["NA1_5635906027"]));
  });

  test("rejects a card request outside the latest query's supported ids", () => {
    expect(() =>
      assertEligibleExploreMatchCardRequests({
        requests: [
          ExploreMatchCardRequestSchema.parse({
            matchId: "NA1_5635906026",
            size: "S",
          }),
        ],
        eligibleMatchIds: new Set(["NA1_5635906027"]),
      }),
    ).toThrow("was not returned as card-supported by the latest query");
  });
});

describe("inferFrameTeamId", () => {
  // Observed Swiftplay shape: 6 stored rows, 10 frame participants.
  const swiftplayRows = [1, 2, 3, 4, 5, 6].map((participantId) => ({
    participant_id: participantId,
    team_id: participantId <= 5 ? 100 : 200,
  }));

  test("attributes missing participants by the confirmed 5v5 split", () => {
    expect(inferFrameTeamId(swiftplayRows, 7)).toBe(200);
    expect(inferFrameTeamId(swiftplayRows, 10)).toBe(200);
    expect(inferFrameTeamId(swiftplayRows, 3)).toBe(100);
  });

  test("refuses to guess when rows disagree with the split", () => {
    const disagreeing = swiftplayRows.map((row) =>
      row.participant_id === 3 ? { ...row, team_id: 200 } : row,
    );
    expect(inferFrameTeamId(disagreeing, 7)).toBeUndefined();
  });

  test("refuses to guess without both sides or with one team", () => {
    const lowSideOnly = swiftplayRows.filter((row) => row.participant_id <= 5);
    expect(inferFrameTeamId(lowSideOnly, 7)).toBeUndefined();
    const singleTeam = swiftplayRows.map((row) => ({ ...row, team_id: 100 }));
    expect(inferFrameTeamId(singleTeam, 7)).toBeUndefined();
  });

  test("refuses out-of-range participant ids", () => {
    expect(inferFrameTeamId(swiftplayRows, 0)).toBeUndefined();
    expect(inferFrameTeamId(swiftplayRows, 11)).toBeUndefined();
  });
});
