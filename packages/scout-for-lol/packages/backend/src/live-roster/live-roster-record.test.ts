import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { RawCurrentGameInfoSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  recordLiveGameRoster,
  recordLiveGameRosterOrReport,
} from "#src/live-roster/live-roster-record.ts";
import { LiveRosterParticipantsSchema } from "#src/live-roster/live-roster-schema.ts";
import {
  LIVE_MATCH_ID,
  liveContext,
  liveGameFixture,
  seatPuuid,
} from "#src/live-roster/live-roster.test-fixtures.ts";

const { prisma } = createTestDatabase("live-roster-record");

afterAll(async () => {
  await prisma.$disconnect();
});

const DETECTED_AT = new Date("2026-11-26T20:00:00.000Z");
const GOLD = JSON.stringify({
  tier: "gold",
  division: 2,
  lp: 40,
  wins: 10,
  losses: 8,
});
const EMERALD = JSON.stringify({
  tier: "emerald",
  division: 1,
  lp: 22,
  wins: 30,
  losses: 20,
});

beforeEach(async () => {
  await prisma.liveGameRoster.deleteMany();
  await prisma.currentRankSnapshot.deleteMany();
  await prisma.matchRankHistory.deleteMany();
});

async function storedRoster() {
  const row = await prisma.liveGameRoster.findUniqueOrThrow({
    where: { riotMatchId: LIVE_MATCH_ID },
  });
  return {
    row,
    participants: LiveRosterParticipantsSchema.parse(row.participants),
  };
}

describe("recordLiveGameRoster", () => {
  test("detection writes the ten-player roster with kit, tree and tracked flags", async () => {
    await prisma.currentRankSnapshot.create({
      data: { puuid: seatPuuid(2), soloRank: GOLD, fetchedAt: DETECTED_AT },
    });

    const outcome = await recordLiveGameRoster(
      liveContext([2]),
      DETECTED_AT,
      prisma,
    );

    expect(outcome).toBe("recorded");
    const { row, participants } = await storedRoster();
    expect(row).toMatchObject({
      platform: "NA1",
      gameId: "5500000777",
      queueId: 420,
      gameMode: "CLASSIC",
      trackedPuuids: [seatPuuid(2)],
      recentForm: {},
      recentFormCompletedAt: null,
    });
    expect(row.gameStartedAt).toEqual(new Date(1_780_000_000_000));
    expect(row.detectedAt).toEqual(DETECTED_AT);
    expect(participants).toHaveLength(10);
    expect(participants.filter((entry) => entry.isTracked)).toHaveLength(1);
    expect(participants[2]).toMatchObject({
      puuid: seatPuuid(2),
      riotId: "RiverQuartz#NA1",
      teamId: 100,
      championId: 103,
      spell1Id: 4,
      spell2Id: 12,
      keystoneId: 8114,
      primaryTreeId: 8100,
      secondaryTreeId: 8200,
      isTracked: true,
      rank: { tier: "gold", division: 2, lp: 40, wins: 10, losses: 8 },
    });
    // Strangers carry no rank: detection never asks Riot for one.
    expect(
      participants.filter((entry) => !entry.isTracked).map((e) => e.rank),
    ).toEqual(Array.from({ length: 9 }, () => null));
  });

  test("the retention clock starts at detection and caps at four hours", async () => {
    await recordLiveGameRoster(liveContext([2]), DETECTED_AT, prisma);
    const { row } = await storedRoster();
    expect(row.expiresAt.getTime() - DETECTED_AT.getTime()).toBe(
      4 * 60 * 60 * 1000,
    );
  });

  test("a hidden participant is stored with no identity", async () => {
    await recordLiveGameRoster(
      liveContext([2], liveGameFixture({ hiddenSeats: [7] })),
      DETECTED_AT,
      prisma,
    );
    const { participants } = await storedRoster();
    expect(participants[7]).toMatchObject({
      puuid: null,
      riotId: null,
      isTracked: false,
      championId: 134,
    });
  });

  test("prefers the newer of the rank snapshot and the last recorded game", async () => {
    await prisma.currentRankSnapshot.create({
      data: {
        puuid: seatPuuid(2),
        soloRank: GOLD,
        fetchedAt: new Date("2026-11-01T00:00:00.000Z"),
      },
    });
    await prisma.matchRankHistory.create({
      data: {
        matchId: RiotMatchIdSchema.parse("NA1_1"),
        puuid: seatPuuid(2),
        queueType: "solo",
        rankAfter: EMERALD,
        matchGameEndAt: new Date("2026-11-20T00:00:00.000Z"),
        capturedAt: new Date("2026-11-20T00:00:00.000Z"),
      },
    });
    await recordLiveGameRoster(liveContext([2]), DETECTED_AT, prisma);
    const { participants } = await storedRoster();
    expect(participants[2]?.rank).toMatchObject({ tier: "emerald", lp: 22 });
  });

  test("a replayed capture keeps the first detection time and any stored form", async () => {
    await recordLiveGameRoster(liveContext([2]), DETECTED_AT, prisma);
    await prisma.liveGameRoster.update({
      where: { riotMatchId: LIVE_MATCH_ID },
      data: { recentFormCompletedAt: DETECTED_AT },
    });

    const replay = await recordLiveGameRoster(
      liveContext([2]),
      new Date(DETECTED_AT.getTime() + 600_000),
      prisma,
    );

    expect(replay).toBe("already-recorded");
    const { row } = await storedRoster();
    expect(row.detectedAt).toEqual(DETECTED_AT);
    expect(row.recentFormCompletedAt).toEqual(DETECTED_AT);
  });

  test("an Arena lobby is not recorded", async () => {
    const arena = RawCurrentGameInfoSchema.parse({
      ...liveGameFixture(),
      gameMode: "CHERRY",
      gameQueueConfigId: 1700,
    });
    expect(
      await recordLiveGameRoster(liveContext([2], arena), DETECTED_AT, prisma),
    ).toBe("skipped");
    expect(await prisma.liveGameRoster.count()).toBe(0);
  });
});

describe("recordLiveGameRosterOrReport", () => {
  test("a broken stored rank is reported, not thrown, and writes nothing", async () => {
    await prisma.currentRankSnapshot.create({
      data: {
        puuid: seatPuuid(2),
        soloRank: '{"tier":"nonsense"}',
        fetchedAt: DETECTED_AT,
      },
    });

    // The capture this runs inside also owes a game-start announcement, which
    // a roster fault must never hold back.
    expect(
      await recordLiveGameRosterOrReport(liveContext([2]), DETECTED_AT, prisma),
    ).toBe("failed");
    expect(await prisma.liveGameRoster.count()).toBe(0);
  });
});
