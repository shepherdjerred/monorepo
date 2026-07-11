import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CompetitionIdSchema } from "@scout-for-lol/data";
import { loadHistoricalLeaderboardSnapshots } from "#src/storage/s3-leaderboard.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

describe("loadHistoricalLeaderboardSnapshots — no bucket configured", () => {
  beforeEach(() => {
    // Drive the no-bucket branch by clearing the env var the lazy
    // configuration getter reads, then forcing a re-read.
    delete Bun.env["S3_BUCKET_NAME"];
    resetConfigurationForTests();
  });

  afterEach(() => {
    // Restore the default bucket for every other file in the shared process.
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
  });

  test("returns an empty array without throwing when S3_BUCKET_NAME is undefined", async () => {
    const id = CompetitionIdSchema.parse(42);
    const result = await loadHistoricalLeaderboardSnapshots(id);
    expect(result).toEqual([]);
  });
});
