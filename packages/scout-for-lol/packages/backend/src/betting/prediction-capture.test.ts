import { describe, expect, test } from "bun:test";
import {
  BucksPredictionObservationSchema,
  RawCurrentGameInfoSchema,
} from "@scout-for-lol/data";
import { capturePredictionForPrematch } from "#src/betting/prediction-capture.ts";
import { buildPredictionObservation } from "#src/betting/prediction-inputs.ts";
import {
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";

const OBSERVED_AT = new Date("2026-08-19T00:00:30Z");

const gameInfo = RawCurrentGameInfoSchema.parse({
  gameId: 5_000_000_001,
  gameStartTime: new Date("2026-08-19T00:00:00Z").getTime(),
  gameMode: "CLASSIC",
  mapId: 11,
  gameType: "MATCHED_GAME",
  gameQueueConfigId: 420,
  gameLength: 30,
  platformId: "NA1",
  participants: bucksTestRoster().map((participant) => ({
    championId: participant.championId,
    puuid: participant.puuid,
    teamId: participant.teamId,
    riotId: participant.riotId ?? "Unknown#NA1",
    spell1Id: 4,
    spell2Id: 14,
    lastSelectedSkinIndex: 0,
    bot: false,
    profileIconId: 1,
  })),
  bannedChampions: [],
});

const observation = BucksPredictionObservationSchema.parse({
  version: 1,
  matchId: "NA1_5000000001",
  platformId: "NA1",
  gameId: "5000000001",
  queueType: "solo",
  observedAt: OBSERVED_AT.toISOString(),
  gameStartAt: new Date("2026-08-19T00:00:00Z").toISOString(),
  prediction: {
    version: 2,
    blueWinProbability: 0.58,
    dataQuality: "medium",
    coverage: { covered: 25, applicable: 50 },
    drivers: ["Blue rank edge"],
  },
  features: Array.from({ length: 10 }, (_unused, index) => ({
    puuid: bucksTestPuuid(index),
    teamId: index < 5 ? 100 : 200,
    championId: index + 1,
    lane: "top",
    rankLeaguePoints: null,
    seasonWins: null,
    seasonLosses: null,
    recentForm: { wins: 0, games: 0 },
    laneForm: { wins: 0, games: 0 },
    championForm: { wins: 0, games: 0 },
  })),
});

describe("capturePredictionForPrematch", () => {
  test("builds from the raw lobby without presentation asset data", async () => {
    const built = await buildPredictionObservation(
      {
        gameInfo,
        ranksByPuuid: new Map(),
        matchId: "NA1_5000000001",
        platformId: "NA1",
        queueType: "solo",
        observedAt: OBSERVED_AT,
        gameStartAt: new Date("2026-08-19T00:00:00Z"),
      },
      { fetchHistory: () => Promise.resolve([]) },
    );
    expect(built?.features).toHaveLength(10);
    expect(built?.prediction.version).toBe(2);
  });

  test("captures eligible games independently of presentation and guild gates", async () => {
    let builds = 0;
    let ingests = 0;
    const result = await capturePredictionForPrematch(
      {
        gameInfo,
        queueType: "solo",
        ranksByPuuid: new Map(),
        observedAt: OBSERVED_AT,
      },
      {
        build: () => {
          builds += 1;
          return Promise.resolve(observation);
        },
        ingest: () => {
          ingests += 1;
          return Promise.resolve();
        },
      },
    );
    expect(result).toEqual(observation.prediction);
    expect(builds).toBe(1);
    expect(ingests).toBe(1);
  });

  test("does not await observation persistence before returning the estimate", async () => {
    let finishIngest: (() => void) | undefined;
    const ingestPending = new Promise<void>((resolve) => {
      finishIngest = resolve;
    });
    const result = await capturePredictionForPrematch(
      {
        gameInfo,
        queueType: "solo",
        ranksByPuuid: new Map(),
        observedAt: OBSERVED_AT,
      },
      {
        build: () => Promise.resolve(observation),
        ingest: () => ingestPending,
      },
    );
    expect(result).toEqual(observation.prediction);
    if (finishIngest === undefined) {
      throw new Error("ingest was not started");
    }
    finishIngest();
  });

  test("isolates an asynchronous observation-store failure", async () => {
    const result = await capturePredictionForPrematch(
      {
        gameInfo,
        queueType: "solo",
        ranksByPuuid: new Map(),
        observedAt: OBSERVED_AT,
      },
      {
        build: () => Promise.resolve(observation),
        ingest: () => Promise.reject(new Error("S3 unavailable")),
      },
    );
    expect(result).toEqual(observation.prediction);
    await Bun.sleep(0);
  });

  test("does no work for an ineligible queue", async () => {
    let builds = 0;
    const result = await capturePredictionForPrematch(
      {
        gameInfo,
        queueType: "aram",
        ranksByPuuid: new Map(),
        observedAt: OBSERVED_AT,
      },
      {
        build: () => {
          builds += 1;
          return Promise.resolve(observation);
        },
        ingest: () => Promise.resolve(),
      },
    );
    expect(result).toBeUndefined();
    expect(builds).toBe(0);
  });
});
