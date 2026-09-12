import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getMetrics } from "#src/metrics/index.ts";
import { savePrematchDataToS3 } from "#src/storage/s3.ts";
import { rawCurrentGameInfoFixture } from "#src/testing/raw-capture-fixtures.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

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
    const gameInfo = rawCurrentGameInfoFixture();
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
