import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getMetrics } from "#src/metrics/index.ts";
import { savePrematchDataToS3 } from "#src/storage/s3.ts";
import { RawCurrentGameInfoSchema } from "@scout-for-lol/data";
import { resetConfigurationForTests } from "#src/configuration.ts";

function makeGameInfo() {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_500_000_002,
    gameStartTime: Date.now(),
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: -15,
    platformId: "NA1",
    bannedChampions: [],
    participants: [
      {
        championId: 157,
        puuid: "test-puuid",
        teamId: 100,
        riotId: "Player#NA1",
        spell1Id: 4,
        spell2Id: 14,
        lastSelectedSkinIndex: 0,
        bot: false,
        profileIconId: 1,
      },
    ],
  });
}

function getCounterValue(
  metrics: string,
  metricName: string,
  status: string,
): number {
  const line = metrics
    .split("\n")
    .find(
      (entry) =>
        entry.startsWith(`${metricName}{`) &&
        entry.includes(`status="${status}"`),
    );

  if (line === undefined) {
    return 0;
  }

  return Number(line.slice(line.lastIndexOf(" ") + 1));
}

describe("savePrematchDataToS3 without S3 bucket", () => {
  beforeEach(() => {
    // Exercise the no-bucket branch by clearing the env var the lazy
    // configuration getter reads, then forcing a re-read.
    delete Bun.env["S3_BUCKET_NAME"];
    resetConfigurationForTests();
  });

  afterEach(() => {
    // Restore the default bucket for every other file in the shared process.
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
  });

  test("returns skipped_no_bucket and records skip metric", async () => {
    const gameInfo = makeGameInfo();
    const metricsBefore = await getMetrics();
    const skippedBefore = getCounterValue(
      metricsBefore,
      "prematch_spectator_payload_saves_total",
      "skipped_no_bucket",
    );

    const result = await savePrematchDataToS3(gameInfo.gameId, gameInfo, [
      "Player",
    ]);

    expect(result).toEqual({ status: "skipped_no_bucket" });

    const metricsAfter = await getMetrics();
    expect(
      getCounterValue(
        metricsAfter,
        "prematch_spectator_payload_saves_total",
        "skipped_no_bucket",
      ) - skippedBefore,
    ).toBe(1);
  });
});
