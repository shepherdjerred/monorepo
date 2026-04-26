import { describe, expect, test, mock } from "bun:test";

// TODO(scout-for-lol): bun's `mock.module()` is process-wide and retroactive,
// so mocking `#src/configuration.ts` here leaks `s3BucketName: undefined` into
// the rest of the backend suite (breaks ~17 unrelated S3 tests). The test is
// gated off until production code is refactored to take the bucket via a
// parameter or factory, which would let us cover the no-bucket path without
// mocking the configuration singleton.
const RUN_NO_BUCKET_TEST = false;

if (RUN_NO_BUCKET_TEST) {
  void mock.module("#src/configuration.ts", () => ({
    default: {
      version: "test",
      gitSha: "test",
      environment: "dev",
      sentryDsn: undefined,
      s3BucketName: undefined,
    },
  }));
}

const { getMetrics } = await import("#src/metrics/index.ts");
const { savePrematchDataToS3 } = await import("#src/storage/s3.ts");
const { RawCurrentGameInfoSchema } = await import("@scout-for-lol/data");

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

describe.skipIf(!RUN_NO_BUCKET_TEST)(
  "savePrematchDataToS3 without S3 bucket",
  () => {
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
  },
);
