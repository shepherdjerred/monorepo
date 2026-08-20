import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import { writeMatchStagingFile } from "#src/report-lake/staging.ts";
import { ReportQueryTimeoutError } from "#src/reports/duckdb/instance.ts";
import { fetchPredictionHistory } from "#src/reports/duckdb/prediction-history.ts";

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const raw: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(raw);
}

function historicalMatch(
  base: RawMatch,
  index: number,
  queueId = base.info.queueId,
): RawMatch {
  const timestamp = base.info.gameCreation + index * 60_000;
  return RawMatchSchema.parse({
    ...base,
    metadata: {
      ...base.metadata,
      matchId: `NA1_600000${index.toString().padStart(4, "0")}`,
    },
    info: {
      ...base.info,
      gameId: base.info.gameId + index,
      gameCreation: timestamp,
      gameStartTimestamp: timestamp,
      gameEndTimestamp: timestamp + base.info.gameDuration * 1000,
      queueId,
    },
  });
}

function remakeMatch(
  base: RawMatch,
  index: number,
  kind: "short" | "game-ended-early" | "team-early",
): RawMatch {
  const match = historicalMatch(base, index);
  const gameDuration = kind === "short" ? 120 : match.info.gameDuration;
  return RawMatchSchema.parse({
    ...match,
    info: {
      ...match.info,
      gameDuration,
      gameEndTimestamp: match.info.gameStartTimestamp + gameDuration * 1000,
      participants: match.info.participants.map(
        (participant, participantIndex) => ({
          ...participant,
          gameEndedInEarlySurrender:
            kind === "game-ended-early" && participantIndex === 2,
          teamEarlySurrendered: kind === "team-early" && participantIndex === 2,
        }),
      ),
    },
  });
}

describe("fetchPredictionHistory", () => {
  test("filters queue/current/future matches and caps each player at 30", async () => {
    const lakeDir = await mkdtemp(path.join(tmpdir(), "prediction-history-"));
    try {
      const base = await loadMatchFixture();
      for (let index = 0; index < 35; index++) {
        expect(
          await writeMatchStagingFile(lakeDir, historicalMatch(base, index)),
        ).toBe(true);
      }
      const shortRemake = remakeMatch(base, 36, "short");
      const earlySurrender = remakeMatch(base, 37, "game-ended-early");
      const teamEarlySurrender = remakeMatch(base, 38, "team-early");
      await writeMatchStagingFile(lakeDir, shortRemake);
      await writeMatchStagingFile(lakeDir, earlySurrender);
      await writeMatchStagingFile(lakeDir, teamEarlySurrender);
      const otherQueueBase = historicalMatch(base, 40, 420);
      const otherQueue = RawMatchSchema.parse({
        ...otherQueueBase,
        info: { ...otherQueueBase.info, gameMode: "CLASSIC" },
      });
      await writeMatchStagingFile(lakeDir, otherQueue);
      const firstPuuid = base.info.participants[0]?.puuid;
      const secondPuuid = base.info.participants[1]?.puuid;
      if (firstPuuid === undefined || secondPuuid === undefined) {
        throw new Error("fixture has no participants");
      }
      const current = historicalMatch(base, 34);
      const beforeMs = base.info.gameCreation + 41 * 60_000;
      const rows = await fetchPredictionHistory({
        puuids: [firstPuuid, secondPuuid],
        excludeMatchId: current.metadata.matchId,
        queue: "arena",
        beforeMs,
        limitPerPlayer: 30,
        lakeDir,
      });
      expect(rows.filter((row) => row.puuid === firstPuuid)).toHaveLength(30);
      expect(rows.filter((row) => row.puuid === secondPuuid)).toHaveLength(30);
      expect(
        rows.some((row) => row.match_id === current.metadata.matchId),
      ).toBe(false);
      expect(
        rows.some((row) => row.match_id === otherQueue.metadata.matchId),
      ).toBe(false);
      expect(
        rows.some((row) => row.match_id === shortRemake.metadata.matchId),
      ).toBe(false);
      expect(
        rows.some((row) => row.match_id === earlySurrender.metadata.matchId),
      ).toBe(false);
      expect(
        rows.some(
          (row) => row.match_id === teamEarlySurrender.metadata.matchId,
        ),
      ).toBe(false);
      expect(rows.every((row) => row.game_creation_ms < beforeMs)).toBe(true);

      await expect(
        fetchPredictionHistory({
          puuids: [firstPuuid, secondPuuid],
          excludeMatchId: current.metadata.matchId,
          queue: "arena",
          beforeMs,
          limitPerPlayer: 30,
          lakeDir,
          timeoutMs: 0,
        }),
      ).rejects.toBeInstanceOf(ReportQueryTimeoutError);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });
});
