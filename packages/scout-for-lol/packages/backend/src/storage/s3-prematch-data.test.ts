import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { rawCurrentGameInfoFixture } from "#src/testing/raw-capture-fixtures.ts";
import {
  getMetrics,
  prematchSpectatorPayloadSaveDurationSeconds,
  prematchSpectatorPayloadSavesTotal,
} from "#src/metrics/index.ts";
import { savePrematchDataToS3 } from "#src/storage/s3.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const s3Mock = mockClient(S3Client);

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
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  resetConfigurationForTests();
  s3Mock.reset();
});

afterEach(() => {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  resetConfigurationForTests();
  s3Mock.reset();
});

describe("savePrematchDataToS3", () => {
  test("returns saved and records metrics on successful upload", async () => {
    const gameInfo = rawCurrentGameInfoFixture();
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

  test("throws after retries when upload fails", async () => {
    const gameInfo = rawCurrentGameInfoFixture();
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

    // S3 is now authoritative: a failed write throws (it no longer returns an
    // "error" status) so the ingest path can fail loud and not lose the game.
    await expect(
      savePrematchDataToS3(gameInfo.gameId, gameInfo, ["Player"]),
    ).rejects.toThrow("upload failed");

    // Retried MAX_PUT_ATTEMPTS (3) times before throwing.
    expect(s3Mock.calls()).toHaveLength(3);

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
