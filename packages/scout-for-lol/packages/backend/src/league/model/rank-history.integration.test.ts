import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  LeaguePuuidSchema,
  MatchIdSchema,
  type Rank,
} from "@scout-for-lol/data";
import {
  getLatestRankAfterAndAtOrBefore,
  getLatestRankAtOrBefore,
  saveMatchRankHistory,
} from "#src/league/model/rank-history.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("rank-history-deadline");
const PUUID = LeaguePuuidSchema.parse("p".repeat(78));
const BEFORE: Rank = {
  tier: "silver",
  division: 1,
  lp: 90,
  wins: 10,
  losses: 10,
};
const AFTER: Rank = {
  tier: "gold",
  division: 4,
  lp: 25,
  wins: 11,
  losses: 10,
};

beforeEach(async () => {
  await db.matchRankHistory.deleteMany({ where: { puuid: PUUID } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("deadline-bounded rank history", () => {
  test("ignores a rank observation from a match after the deadline", async () => {
    const deadline = new Date("2026-02-08T00:00:00.000Z");
    await saveMatchRankHistory({
      matchId: MatchIdSchema.parse("NA1_BEFORE_DEADLINE"),
      puuid: PUUID,
      queueType: "solo",
      rankBefore: BEFORE,
      rankAfter: BEFORE,
      matchGameCreationTimestamp: deadline.getTime() - 2000,
      matchGameEndTimestamp: deadline.getTime(),
      capturedAt: new Date(deadline.getTime() + 60_000),
      prismaClient: db,
    });
    await saveMatchRankHistory({
      matchId: MatchIdSchema.parse("NA1_AFTER_DEADLINE"),
      puuid: PUUID,
      queueType: "solo",
      rankBefore: BEFORE,
      rankAfter: AFTER,
      matchGameCreationTimestamp: deadline.getTime() + 1000,
      matchGameEndTimestamp: deadline.getTime() + 2000,
      capturedAt: new Date(deadline.getTime() + 120_000),
      prismaClient: db,
    });

    await expect(
      getLatestRankAtOrBefore(PUUID, "solo", deadline.getTime(), db),
    ).resolves.toEqual(BEFORE);
  });

  test("ignores observations at or before activation", async () => {
    const activation = new Date("2026-02-01T00:00:00.000Z");
    const deadline = new Date("2026-02-08T00:00:00.000Z");
    await saveMatchRankHistory({
      matchId: MatchIdSchema.parse("NA1_BEFORE_ACTIVATION"),
      puuid: PUUID,
      queueType: "solo",
      rankBefore: AFTER,
      rankAfter: AFTER,
      matchGameCreationTimestamp: activation.getTime() - 2000,
      matchGameEndTimestamp: activation.getTime(),
      capturedAt: activation,
      prismaClient: db,
    });

    await expect(
      getLatestRankAfterAndAtOrBefore(
        PUUID,
        "solo",
        {
          afterTimestamp: activation.getTime(),
          timestamp: deadline.getTime(),
        },
        db,
      ),
    ).resolves.toBeUndefined();
  });
});
