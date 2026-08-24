import { describe, expect, test } from "vitest";
import {
  CompetitionIdSchema,
  PlayerIdSchema,
  type CachedLeaderboard,
} from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import {
  mergeCompetitionRankHistory,
  standingsFromResult,
} from "#src/league/competition/analysis-results.ts";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";

const competitionId = CompetitionIdSchema.parse(1);
const playerId = PlayerIdSchema.parse(10);

describe("competition analysis results", () => {
  test("merges partial lake history with authoritative snapshots", () => {
    const lakeOnly = snapshot("2026-05-02T00:00:00.000Z", 2);
    const duplicateLake = snapshot("2026-05-03T00:00:00.000Z", 30);
    const authoritative = snapshot("2026-05-03T00:00:00.000Z", 3);

    const merged = mergeCompetitionRankHistory(
      [lakeOnly, duplicateLake],
      [snapshot("2026-05-01T00:00:00.000Z", 1), authoritative],
    );

    expect(merged.map((item) => item.calculatedAt)).toEqual([
      "2026-05-01T00:00:00.000Z",
      "2026-05-02T00:00:00.000Z",
      "2026-05-03T00:00:00.000Z",
    ]);
    expect(merged[2]).toEqual(authoritative);
  });

  test("replaces a stale lake day with an empty authoritative snapshot", () => {
    const staleLake = snapshot("2026-05-03T12:00:00.000Z", 30);
    const authoritative = {
      ...snapshot("2026-05-03T13:00:00.000Z", 3),
      entries: [],
    };

    expect(mergeCompetitionRankHistory([staleLake], [authoritative])).toEqual([
      authoritative,
    ]);
  });

  test("rejects standings rows without player identities", () => {
    const result: ReportQueryResult = {
      plan: compileScoutQl(
        "SELECT COUNT(*) AS games FROM competition_match_participants " +
          "WHERE competition_id = 7 AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
          "GROUP BY player",
      ),
      columns: ["label", "games"],
      rows: [
        {
          label: "Missing player",
          dimensions: ["Missing player"],
          keys: ["Missing player"],
          mentionIdentity: null,
          values: [{ column: "games", value: 4 }],
        },
      ],
      rowsScanned: 4,
      range: { startDate: new Date(0), endDate: new Date() },
    };

    expect(() => standingsFromResult(result)).toThrow(
      'Competition standings row "Missing player" is missing its player identity.',
    );
  });
});

function snapshot(calculatedAt: string, score: number): CachedLeaderboard {
  return {
    version: "v1",
    competitionId,
    calculatedAt,
    entries: [
      {
        playerId,
        playerName: "Alpha",
        score,
        rank: 1,
      },
    ],
  };
}
