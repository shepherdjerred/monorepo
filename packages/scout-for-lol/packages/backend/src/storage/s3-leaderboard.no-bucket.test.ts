import { describe, expect, test, mock } from "bun:test";

// TODO(scout-for-lol): bun's `mock.module()` is process-wide and retroactive,
// so mocking `#src/configuration.ts` here leaks `s3BucketName: undefined` into
// the rest of the backend suite. Gated off until production code accepts the
// bucket via parameter/factory and we can cover the no-bucket path without
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

const { CompetitionIdSchema } = await import("@scout-for-lol/data");
const { loadHistoricalLeaderboardSnapshots } =
  await import("#src/storage/s3-leaderboard.ts");

describe.skipIf(!RUN_NO_BUCKET_TEST)(
  "loadHistoricalLeaderboardSnapshots — no bucket configured",
  () => {
    test("returns an empty array without throwing when S3_BUCKET_NAME is undefined", async () => {
      const id = CompetitionIdSchema.parse(42);
      const result = await loadHistoricalLeaderboardSnapshots(id);
      expect(result).toEqual([]);
    });
  },
);
