import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";

void mock.module("#src/configuration.ts", () => ({
  default: {
    version: "test",
    gitSha: "test",
    environment: "dev",
    sentryDsn: undefined,
    s3BucketName: "test-bucket",
  },
}));

const { RawCurrentGameInfoSchema } = await import("@scout-for-lol/data");
const {
  getMetrics,
  prematchSpectatorPayloadSaveDurationSeconds,
  prematchSpectatorPayloadSavesTotal,
} = await import("#src/metrics/index.ts");
const { savePrematchDataToS3 } = await import("#src/storage/s3.ts");

const s3Mock = mockClient(S3Client);

function makeGameInfo() {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_500_000_001,
    gameStartTime: Date.now(),
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: -30,
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

function getHistogramCount(metrics: string, metricName: string): number {
  const line = metrics
    .split("\n")
    .find((entry) => entry.startsWith(`${metricName}_count`));

  if (line === undefined) {
    return 0;
  }

  return Number(line.slice(line.lastIndexOf(" ") + 1));
}

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

describe("savePrematchDataToS3", () => {
  test("returns saved and records metrics on successful upload", async () => {
    const gameInfo = makeGameInfo();
    const metricsBefore = await getMetrics();
    const savedBefore = getCounterValue(
      metricsBefore,
      "prematch_spectator_payload_saves_total",
      "saved",
    );
    const durationCountBefore = getHistogramCount(
      metricsBefore,
      "prematch_spectator_payload_save_duration_seconds",
    );

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await savePrematchDataToS3(gameInfo.gameId, gameInfo, [
      "Player",
    ]);

    expect(result.status).toBe("saved");
    expect(typeof result.durationSeconds).toBe("number");
    expect(s3Mock.calls()).toHaveLength(1);

    const command = s3Mock.call(0)?.args?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);

    const metricsAfter = await getMetrics();
    expect(
      getCounterValue(
        metricsAfter,
        "prematch_spectator_payload_saves_total",
        "saved",
      ) - savedBefore,
    ).toBe(1);
    expect(
      getHistogramCount(
        metricsAfter,
        "prematch_spectator_payload_save_duration_seconds",
      ) - durationCountBefore,
    ).toBe(1);

    const saveMetric = await prematchSpectatorPayloadSavesTotal.get();
    expect(
      saveMetric.values.some((value) => value.labels.status === "saved"),
    ).toBe(true);
    const durationMetric =
      await prematchSpectatorPayloadSaveDurationSeconds.get();
    expect(durationMetric.values.length > 0).toBe(true);
  });

  test("returns error without throwing when upload fails", async () => {
    const gameInfo = makeGameInfo();
    const metricsBefore = await getMetrics();
    const errorBefore = getCounterValue(
      metricsBefore,
      "prematch_spectator_payload_saves_total",
      "error",
    );
    const durationCountBefore = getHistogramCount(
      metricsBefore,
      "prematch_spectator_payload_save_duration_seconds",
    );

    s3Mock.on(PutObjectCommand).rejects(new Error("upload failed"));

    const result = await savePrematchDataToS3(gameInfo.gameId, gameInfo, [
      "Player",
    ]);

    expect(result.status).toBe("error");
    expect(typeof result.durationSeconds).toBe("number");
    expect(s3Mock.calls()).toHaveLength(1);

    const metricsAfter = await getMetrics();
    expect(
      getCounterValue(
        metricsAfter,
        "prematch_spectator_payload_saves_total",
        "error",
      ) - errorBefore,
    ).toBe(1);
    expect(
      getHistogramCount(
        metricsAfter,
        "prematch_spectator_payload_save_duration_seconds",
      ) - durationCountBefore,
    ).toBe(1);
  });
});
