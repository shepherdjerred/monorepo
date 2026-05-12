import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { SEASONS } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { seedSeasons } from "#src/database/season-seeder.ts";

const { prisma } = createTestDatabase("season-seeder-test");

const SEASON_COUNT = Object.keys(SEASONS).length;

beforeEach(async () => {
  // Clear competitions before seasons (FK from Competition.seasonId).
  await prisma.competitionSnapshot.deleteMany();
  await prisma.competitionParticipant.deleteMany();
  await prisma.competition.deleteMany();
  await prisma.season.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seedSeasons", () => {
  test("inserts every SEASONS entry into an empty table", async () => {
    const result = await seedSeasons(prisma);

    expect(result.upserted).toBe(SEASON_COUNT);

    const rows = await prisma.season.findMany({
      orderBy: { startDate: "asc" },
    });
    expect(rows).toHaveLength(SEASON_COUNT);

    for (const expected of Object.values(SEASONS)) {
      const got = rows.find((r) => r.id === expected.id);
      expect(got).toBeDefined();
      expect(got?.displayName).toBe(expected.displayName);
      expect(got?.startDate.getTime()).toBe(expected.startDate.getTime());
      expect(got?.endDate.getTime()).toBe(expected.endDate.getTime());
    }
  });

  test("updates a stale row to match the current SEASONS entry", async () => {
    const target = SEASONS["2026_SEASON_1_ACT_1"];
    // Pre-seed with deliberately-wrong dates to simulate code drift
    await prisma.season.create({
      data: {
        id: target.id,
        displayName: "wrong name",
        startDate: new Date("2000-01-01T00:00:00.000Z"),
        endDate: new Date("2000-12-31T23:59:59.000Z"),
      },
    });

    const result = await seedSeasons(prisma);
    expect(result.upserted).toBe(SEASON_COUNT);

    const refreshed = await prisma.season.findUnique({
      where: { id: target.id },
    });
    expect(refreshed?.displayName).toBe(target.displayName);
    expect(refreshed?.startDate.getTime()).toBe(target.startDate.getTime());
    expect(refreshed?.endDate.getTime()).toBe(target.endDate.getTime());
  });

  test("is idempotent: second run reports the same count and leaves rows unchanged", async () => {
    await seedSeasons(prisma);
    const before = await prisma.season.findMany();

    const second = await seedSeasons(prisma);
    expect(second.upserted).toBe(SEASON_COUNT);

    const after = await prisma.season.findMany();
    expect(after).toHaveLength(before.length);
    for (const b of before) {
      const a = after.find((r) => r.id === b.id);
      expect(a?.startDate.getTime()).toBe(b.startDate.getTime());
      expect(a?.endDate.getTime()).toBe(b.endDate.getTime());
    }
  });
});
