import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { MY_SERVER } from "#src/configuration/flags.ts";
import { createCompetition } from "#src/database/competition/queries.ts";
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

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("syncSystemReports", () => {
  test("seeds Common Denominator top and bottom pairing reports", async () => {
    await syncSystemReports({
      prisma,
      now: new Date(Date.UTC(2026, 4, 17, 12, 0, 0)),
    });

    const reports = await prisma.report.findMany({
      where: {
        serverId: MY_SERVER,
        systemSource: "COMMON_DENOMINATOR",
        isEnabled: true,
      },
      orderBy: { title: "asc" },
    });

    expect(reports.map((report) => report.title)).toEqual([
      "Common Denominator - ARAM Bottom Pairings",
      "Common Denominator - ARAM Pairings",
      "Common Denominator - Arena Bottom Pairings",
      "Common Denominator - Arena Pairings",
      "Common Denominator - Ranked Bottom Pairings",
      "Common Denominator - Ranked Pairings",
      "Common Denominator - Ranked Surrender Leaders",
    ]);
    const bottomReports = reports.filter((report) =>
      report.title.includes("Bottom Pairings"),
    );
    expect(bottomReports).toHaveLength(3);
    for (const report of bottomReports) {
      expect(report.queryText).toContain("ORDER BY win_rate ASC");
    }
  });

  test("caps system competition bar charts to top 10 rows", async () => {
    const now = new Date();
    const competition = await createCompetition(prisma, {
      serverId: testGuildId("777001"),
      ownerId: testAccountId("777002"),
      channelId: testChannelId("777003"),
      title: "Most League of Legends",
      description: "Track most games played",
      visibility: "OPEN",
      maxParticipants: 24,
      dates: {
        type: "FIXED_DATES",
        startDate: new Date(now.getTime() - 86_400_000),
        endDate: new Date(now.getTime() + 86_400_000),
      },
      criteria: {
        type: "MOST_GAMES_PLAYED",
        queue: "RANKED_ANY",
      },
    });
    await prisma.competition.update({
      where: { id: competition.id },
      data: { startProcessedAt: now },
    });

    await syncSystemReports({ prisma, now });

    const report = await prisma.report.findFirstOrThrow({
      where: {
        sourceCompetitionId: competition.id,
        systemSource: "COMPETITION",
      },
    });
    expect(report.outputFormat).toBe("BAR_CHART");
    expect(report.maxRows).toBe(10);
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.reportRun.deleteMany());
  await deleteIfExists(() => prisma.report.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
}
