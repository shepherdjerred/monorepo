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

  // Regression for the silent-skip bug observed 2026-06-14: every minute the
  // dispatcher would call `syncSystemReports`, which used to spread
  // `nextScheduledRunAt: computeNextScheduledUpdateAt(...)` into the update.
  // For COMMON_DENOMINATOR that advanced past the current fire window before
  // `runDueReports` ran. After this fix, re-sync at a later time must leave
  // the existing `nextScheduledRunAt` alone.
  test("re-syncing preserves existing nextScheduledRunAt for COMMON_DENOMINATOR", async () => {
    const t1 = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
    await syncSystemReports({ prisma, now: t1 });
    const initial = await prisma.report.findMany({
      where: {
        serverId: MY_SERVER,
        systemSource: "COMMON_DENOMINATOR",
      },
      orderBy: { title: "asc" },
      select: { id: true, title: true, nextScheduledRunAt: true },
    });
    expect(initial.length).toBeGreaterThan(0);

    const t2 = new Date(t1.getTime() + 60_000);
    await syncSystemReports({ prisma, now: t2 });
    const after = await prisma.report.findMany({
      where: {
        serverId: MY_SERVER,
        systemSource: "COMMON_DENOMINATOR",
      },
      orderBy: { title: "asc" },
      select: { id: true, title: true, nextScheduledRunAt: true },
    });

    for (const [index, report] of after.entries()) {
      expect(report.nextScheduledRunAt?.getTime()).toBe(
        initial[index]?.nextScheduledRunAt?.getTime(),
      );
    }
  });

  // We DO want sync to recompute nextScheduledRunAt when the cron itself
  // changes — otherwise a code-deploy that retunes COMMON_DENOMINATOR_CRON
  // would never take effect.
  test("re-syncing recomputes nextScheduledRunAt when cronExpression changes", async () => {
    const t1 = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
    await syncSystemReports({ prisma, now: t1 });
    const target = await prisma.report.findFirstOrThrow({
      where: {
        serverId: MY_SERVER,
        systemSource: "COMMON_DENOMINATOR",
      },
      orderBy: { title: "asc" },
    });

    // Simulate a cron drift by hand-overwriting both the stored
    // expression and the next-fire to values the definition will NOT
    // match. After the next sync, the recompute path must restore the
    // definition's cron and recompute `nextScheduledRunAt` against it.
    const fictionalNext = new Date(t1.getTime() + 365 * 24 * 60 * 60 * 1000);
    await prisma.report.update({
      where: { id: target.id },
      data: {
        cronExpression: "0 12 * * 1",
        nextScheduledRunAt: fictionalNext,
      },
    });

    const t2 = new Date(t1.getTime() + 60_000);
    await syncSystemReports({ prisma, now: t2 });
    const after = await prisma.report.findUniqueOrThrow({
      where: { id: target.id },
      select: { cronExpression: true, nextScheduledRunAt: true },
    });
    expect(after.cronExpression).toBe("0 18 * * 0");
    // The hand-set fictional next must have been overwritten — the recompute
    // returns the real next-Sunday-18:00 UTC, not our 1-year-out marker.
    expect(after.nextScheduledRunAt?.getTime()).not.toBe(
      fictionalNext.getTime(),
    );
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
    expect(report.queryText).toContain("RENDER bar_chart");
    expect(report.maxRows).toBe(10);
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.reportRun.deleteMany());
  await deleteIfExists(() => prisma.report.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
}
