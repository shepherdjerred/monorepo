import { afterAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BucksPredictionObservationSchema,
  RawMatchSchema,
  type BucksPredictionObservation,
  type RawMatch,
} from "@scout-for-lol/data";
import { loadPredictionEvaluationRows } from "#src/betting/prediction-evaluation.ts";
import { runReportLakeFold } from "#src/report-lake/compactor.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";
import {
  buildDirPath,
  ensureLakeScaffold,
  publishBuild,
} from "#src/report-lake/paths.ts";
import {
  listStagingFiles,
  writeMatchStagingFile,
  writePredictionObservationStagingFile,
} from "#src/report-lake/staging.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("prediction-observation-lake");

afterAll(async () => {
  await prisma.$disconnect();
});

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const raw: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(raw);
}

function observationFor(
  match: RawMatch,
  probability: number,
  observedAtOffsetMs = 0,
): BucksPredictionObservation {
  return BucksPredictionObservationSchema.parse({
    version: 1,
    matchId: match.metadata.matchId,
    platformId: match.info.platformId,
    gameId: match.info.gameId.toString(),
    queueType: "arena",
    observedAt: new Date(
      match.info.gameCreation - 60_000 + observedAtOffsetMs,
    ).toISOString(),
    gameStartAt: new Date(match.info.gameStartTimestamp).toISOString(),
    prediction: {
      version: 2,
      blueWinProbability: probability,
      dataQuality: "low",
      coverage: { covered: 0, applicable: 30 },
      drivers: [],
    },
    features: match.info.participants.slice(0, 10).map((participant) => ({
      puuid: participant.puuid,
      teamId: participant.teamId,
      championId: participant.championId,
      lane: participant.teamPosition,
      rankLeaguePoints: null,
      seasonWins: null,
      seasonLosses: null,
      recentForm: { wins: 0, games: 0 },
      laneForm: { wins: 0, games: 0 },
      championForm: { wins: 0, games: 0 },
    })),
  });
}

function remakeFrom(
  match: RawMatch,
  gameIdOffset: number,
  kind: "short" | "game-ended-early" | "team-early",
): RawMatch {
  const gameId = match.info.gameId + gameIdOffset;
  const duration = kind === "short" ? 120 : match.info.gameDuration;
  return RawMatchSchema.parse({
    ...match,
    metadata: {
      ...match.metadata,
      matchId: `${match.info.platformId}_${gameId.toString()}`,
    },
    info: {
      ...match.info,
      gameId,
      gameDuration: duration,
      gameEndTimestamp: match.info.gameStartTimestamp + duration * 1000,
      participants: match.info.participants.map((participant) => ({
        ...participant,
        gameEndedInEarlySurrender:
          kind === "game-ended-early" || participant.gameEndedInEarlySurrender,
        teamEarlySurrendered:
          kind === "team-early" || participant.teamEarlySurrendered,
      })),
    },
  });
}

describe("prediction observation lake", () => {
  test("overwrites once per match and joins the later outcome by match ID", async () => {
    const lakeDir = await mkdtemp(
      path.join(tmpdir(), "prediction-observation-"),
    );
    try {
      const match = await loadMatchFixture();
      await writeMatchStagingFile(lakeDir, match);
      await writePredictionObservationStagingFile(
        lakeDir,
        observationFor(match, 0.6),
      );
      await writePredictionObservationStagingFile(
        lakeDir,
        observationFor(match, 0.7),
      );
      const shortRemake = remakeFrom(match, 1, "short");
      const earlySurrender = remakeFrom(match, 2, "game-ended-early");
      const teamEarlySurrender = remakeFrom(match, 3, "team-early");
      await writeMatchStagingFile(lakeDir, shortRemake);
      await writeMatchStagingFile(lakeDir, earlySurrender);
      await writeMatchStagingFile(lakeDir, teamEarlySurrender);
      await writePredictionObservationStagingFile(
        lakeDir,
        observationFor(shortRemake, 0.9),
      );
      await writePredictionObservationStagingFile(
        lakeDir,
        observationFor(earlySurrender, 0.1),
      );
      await writePredictionObservationStagingFile(
        lakeDir,
        observationFor(teamEarlySurrender, 0.8),
      );
      expect(
        await listStagingFiles(lakeDir, "prediction_observations"),
      ).toHaveLength(4);
      const rows = await loadPredictionEvaluationRows(lakeDir);
      const blueWon = match.info.participants.some(
        (participant) => participant.teamId === 100 && participant.win,
      );
      expect(rows).toEqual([
        {
          queue: "arena",
          dataQuality: "low",
          probability: 0.7,
          blueWon,
        },
      ]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("keeps the newest prediction after staging and repeated folds", async () => {
    const lakeDir = await mkdtemp(
      path.join(tmpdir(), "prediction-observation-compacted-"),
    );
    try {
      const match = await loadMatchFixture();
      await ensureLakeScaffold(lakeDir);
      const seedBuildId = "seed";
      const seedBuildDir = buildDirPath(lakeDir, seedBuildId);
      await mkdir(seedBuildDir, { recursive: true });
      await Bun.write(
        path.join(seedBuildDir, "manifest.json"),
        JSON.stringify({ schemaFingerprint: lakeSchemaFingerprint() }),
      );
      await publishBuild(lakeDir, seedBuildId);

      await writeMatchStagingFile(lakeDir, match);
      await writePredictionObservationStagingFile(
        lakeDir,
        observationFor(match, 0.6),
      );
      const fold = await runReportLakeFold({ prisma, lakeDir });
      expect(fold?.predictionObservationRows).toBe(1);

      await writePredictionObservationStagingFile(
        lakeDir,
        observationFor(match, 0.7, 30_000),
      );
      const stagedRows = await loadPredictionEvaluationRows(lakeDir);
      expect(stagedRows).toEqual([
        expect.objectContaining({ probability: 0.7 }),
      ]);

      const rewriteFold = await runReportLakeFold({ prisma, lakeDir });
      expect(rewriteFold?.predictionObservationRows).toBe(1);
      const foldedRows = await loadPredictionEvaluationRows(lakeDir);
      expect(foldedRows).toEqual([
        expect.objectContaining({ probability: 0.7 }),
      ]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });
});
