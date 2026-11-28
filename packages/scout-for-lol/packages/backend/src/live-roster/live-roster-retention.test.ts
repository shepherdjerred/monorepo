import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { LIVE_GAME_TTL_MS } from "#src/temporal/prematch/prematch-intents.ts";
import {
  LIVE_ROSTER_ENDED_RETENTION_MS,
  LIVE_ROSTER_LIVE_WINDOW_MS,
  liveRosterExpiresAt,
  purgeExpiredLiveRosters,
} from "#src/live-roster/live-roster-retention.ts";

const { prisma } = createTestDatabase("live-roster-retention");

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date("2026-11-26T20:00:00.000Z");
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60 * 1000);

beforeEach(async () => {
  await prisma.liveGameRoster.deleteMany();
  await prisma.matchTrackedAccount.deleteMany();
});

async function seedRoster(gameId: number, detectedAt: Date) {
  const riotMatchId = RiotMatchIdSchema.parse(`NA1_${gameId.toString()}`);
  await prisma.liveGameRoster.create({
    data: {
      riotMatchId,
      platform: "NA1",
      gameId: gameId.toString(),
      queueId: 420,
      gameMode: "CLASSIC",
      detectedAt,
      expiresAt: liveRosterExpiresAt(detectedAt),
      participants: [],
      trackedPuuids: [],
    },
  });
  return riotMatchId;
}

async function remaining() {
  const rows = await prisma.liveGameRoster.findMany({
    select: { gameId: true },
    orderBy: { gameId: "asc" },
  });
  return rows.map((row) => row.gameId);
}

describe("the retention window", () => {
  test("is the live window plus one hour, and the live window is the capture's own", () => {
    expect(LIVE_ROSTER_LIVE_WINDOW_MS).toBe(LIVE_GAME_TTL_MS);
    expect(LIVE_ROSTER_ENDED_RETENTION_MS).toBe(60 * 60 * 1000);
    expect(liveRosterExpiresAt(NOW).getTime() - NOW.getTime()).toBe(
      4 * 60 * 60 * 1000,
    );
  });
});

describe("purgeExpiredLiveRosters", () => {
  test("removes a roster past its hard cap, whatever happened to its game", async () => {
    await seedRoster(1, hoursAgo(5));
    await seedRoster(2, hoursAgo(1));

    const result = await purgeExpiredLiveRosters(NOW, prisma);

    expect(result).toEqual({ expired: 1, ended: 0 });
    expect(await remaining()).toEqual(["2"]);
  });

  test("keeps a game that ended less than an hour ago, and removes one that ended more than an hour ago", async () => {
    const recentlyEnded = await seedRoster(3, hoursAgo(1));
    const longEnded = await seedRoster(4, hoursAgo(2));
    await seedRoster(5, hoursAgo(1));
    await prisma.matchTrackedAccount.createMany({
      data: [
        {
          riotMatchId: recentlyEnded,
          puuid: testPuuid("a"),
          createdAt: minutesAgo(59),
        },
        {
          riotMatchId: longEnded,
          puuid: testPuuid("b"),
          createdAt: minutesAgo(61),
        },
      ],
    });

    const result = await purgeExpiredLiveRosters(NOW, prisma);

    expect(result).toEqual({ expired: 0, ended: 1 });
    // The ended-recently game and the still-live one stay.
    expect(await remaining()).toEqual(["3", "5"]);
  });

  test("a live game is never purged early", async () => {
    await seedRoster(6, hoursAgo(3));
    expect(await purgeExpiredLiveRosters(NOW, prisma)).toEqual({
      expired: 0,
      ended: 0,
    });
    expect(await remaining()).toEqual(["6"]);
  });
});
