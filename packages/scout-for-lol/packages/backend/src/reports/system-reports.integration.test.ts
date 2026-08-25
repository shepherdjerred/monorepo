import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { CompetitionIdSchema } from "@scout-for-lol/data";
import { syncSystemReports } from "#src/reports/system-reports.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("system-reports-test");

const REPORT_DEFAULTS = {
  serverId: testGuildId("777001"),
  ownerId: testAccountId("777002"),
  channelId: testChannelId("777003"),
  description: null,
  queryText:
    "SELECT player, score FROM competition_rank WHERE competition_id = 1 GROUP BY player DURING ALL TIME ORDER BY score DESC LIMIT 10 RENDER leaderboard",
  cronExpression: "0 9 * * *",
  scheduleTimezone: "UTC",
  nextScheduledRunAt: new Date("2026-08-24T09:00:00.000Z"),
} as const;

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("syncSystemReports", () => {
  test("does not create a generic report for a competition", async () => {
    expect(await syncSystemReports({ prisma })).toEqual({
      created: 0,
      updated: 0,
      disabled: 0,
    });
    expect(await prisma.report.count()).toBe(0);
  });

  test("disables legacy competition reports without touching user reports", async () => {
    const now = new Date("2026-08-24T12:34:00.000Z");
    const legacy = await prisma.report.create({
      data: {
        ...REPORT_DEFAULTS,
        title: "Legacy competition report",
        isEnabled: true,
        isSystemManaged: true,
        systemSource: "COMPETITION",
        sourceCompetitionId: CompetitionIdSchema.parse(1),
        createdTime: new Date("2026-08-01T00:00:00.000Z"),
        updatedTime: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const userReport = await prisma.report.create({
      data: {
        ...REPORT_DEFAULTS,
        title: "User report",
        isEnabled: true,
        isSystemManaged: false,
        systemSource: null,
        sourceCompetitionId: null,
        createdTime: new Date("2026-08-01T00:00:00.000Z"),
        updatedTime: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    expect(await syncSystemReports({ prisma, now })).toEqual({
      created: 0,
      updated: 0,
      disabled: 1,
    });

    expect(
      await prisma.report.findUniqueOrThrow({ where: { id: legacy.id } }),
    ).toMatchObject({ isEnabled: false, updatedTime: now });
    expect(
      await prisma.report.findUniqueOrThrow({ where: { id: userReport.id } }),
    ).toMatchObject({ isEnabled: true });
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.reportRun.deleteMany());
  await deleteIfExists(() => prisma.report.deleteMany());
}
