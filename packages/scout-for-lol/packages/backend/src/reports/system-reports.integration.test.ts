import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { parseAndCompile, type CompetitionId } from "@scout-for-lol/data";
import { DEFAULT_COMPETITION_CRON } from "@scout-for-lol/data/model/competition-cron.ts";
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

// The former COMMON_DENOMINATOR bootstrap has been retired — the only reports
// seeded from code now are per-active-competition. These tests exercise that
// path plus the `updateSystemReport`/`disableStaleSystemReports` machinery.

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// Create a competition that competitionReportDefinitions() will treat as
// ACTIVE (startProcessedAt set, not cancelled, not ended, and — per
// getCompetitionStatus, which compares against the real clock — a date window
// straddling now), so the next syncSystemReports seeds one report row for it.
async function seedActiveCompetition(): Promise<CompetitionId> {
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
  return competition.id;
}

async function competitionReport(competitionId: CompetitionId) {
  return await prisma.report.findFirstOrThrow({
    where: { sourceCompetitionId: competitionId, systemSource: "COMPETITION" },
  });
}

describe("syncSystemReports", () => {
  test("seeds one report for an active competition", async () => {
    const competitionId = await seedActiveCompetition();

    await syncSystemReports({ prisma, now: new Date() });

    const report = await competitionReport(competitionId);
    expect(report.isSystemManaged).toBe(true);
    expect(report.isEnabled).toBe(true);
    expect(report.queryText).toContain("FROM competition_match_participants");
  });

  test("caps system competition bar charts to top 10 rows", async () => {
    const competitionId = await seedActiveCompetition();

    await syncSystemReports({ prisma, now: new Date() });

    const report = await competitionReport(competitionId);
    expect(report.queryText).toContain("RENDER bar_chart");
    expect(parseAndCompile(report.queryText).limit).toBe(10);
  });

  test("disables a competition report once the competition ends", async () => {
    const competitionId = await seedActiveCompetition();
    await syncSystemReports({ prisma, now: new Date() });

    // The competition ends — it drops out of the active-definitions set, so
    // the next sync must disable (not delete) its report.
    await prisma.competition.update({
      where: { id: competitionId },
      data: { endProcessedAt: new Date() },
    });
    await syncSystemReports({ prisma, now: new Date() });

    const report = await competitionReport(competitionId);
    expect(report.isEnabled).toBe(false);
  });

  // Regression for the silent-skip bug observed 2026-06-14: every minute the
  // dispatcher calls `syncSystemReports`, which used to spread a freshly
  // recomputed `nextScheduledRunAt` into the update — clobbering the value the
  // dispatcher had already advanced to the next fire. Re-sync with an unchanged
  // cron must leave the stored `nextScheduledRunAt` alone.
  test("re-syncing preserves nextScheduledRunAt when the cron is unchanged", async () => {
    const competitionId = await seedActiveCompetition();
    await syncSystemReports({ prisma, now: new Date() });
    const report = await competitionReport(competitionId);

    // Simulate the dispatcher advancing the next fire after a run.
    const advanced = new Date(Date.UTC(2027, 0, 1, 0, 0, 0));
    await prisma.report.update({
      where: { id: report.id },
      data: { nextScheduledRunAt: advanced },
    });

    await syncSystemReports({ prisma, now: new Date() });
    const after = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
      select: { nextScheduledRunAt: true },
    });
    expect(after.nextScheduledRunAt?.getTime()).toBe(advanced.getTime());
  });

  // We DO want sync to recompute nextScheduledRunAt when the cron itself
  // changes — otherwise a re-tuned schedule would never take effect.
  test("re-syncing recomputes nextScheduledRunAt when the cron changes", async () => {
    const competitionId = await seedActiveCompetition();
    await syncSystemReports({ prisma, now: new Date() });
    const report = await competitionReport(competitionId);

    // Hand-overwrite the stored cron + next-fire to values the definition
    // (which uses DEFAULT_COMPETITION_CRON) will NOT match. The next sync's
    // recompute path must restore the definition cron and recompute
    // nextScheduledRunAt against it.
    const fictionalNext = new Date(Date.UTC(2027, 0, 1, 0, 0, 0));
    await prisma.report.update({
      where: { id: report.id },
      data: { cronExpression: "0 12 * * 1", nextScheduledRunAt: fictionalNext },
    });

    await syncSystemReports({ prisma, now: new Date() });
    const after = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
      select: { cronExpression: true, nextScheduledRunAt: true },
    });
    expect(after.cronExpression).toBe(DEFAULT_COMPETITION_CRON);
    expect(after.nextScheduledRunAt?.getTime()).not.toBe(
      fictionalNext.getTime(),
    );
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.reportRun.deleteMany());
  await deleteIfExists(() => prisma.report.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
}
