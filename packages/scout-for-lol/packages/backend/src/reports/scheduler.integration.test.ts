import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { runDueReports } from "#src/reports/scheduler.ts";
import { scoutScheduledReportLastSuccessTimestamp } from "#src/metrics/report-runs.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("scheduler-test");

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const REPORT_DEFAULTS = {
  serverId: testGuildId("999001"),
  ownerId: testAccountId("999002"),
  channelId: testChannelId("999003"),
  description: null,
  queryText:
    "SELECT player, score FROM competition_rank WHERE competition_id = 0 GROUP BY player ORDER BY score DESC",
  lookbackDays: 30,
  maxRows: 10,
  isEnabled: true,
  isSystemManaged: false,
  systemSource: null,
  sourceCompetitionId: null,
  cronExpression: "0 0 * * *",
} as const;

describe("runDueReports", () => {
  test("returns empty + writes nothing when no reports are due", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.report.create({
      data: {
        ...REPORT_DEFAULTS,
        title: "Not yet due",
        nextScheduledRunAt: future,
        createdTime: new Date(),
        updatedTime: new Date(),
      },
    });

    const before = await prisma.report.findFirstOrThrow({
      orderBy: { id: "asc" },
    });
    const dispatches = await runDueReports({ prisma });
    expect(dispatches).toHaveLength(0);

    const after = await prisma.report.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.nextScheduledRunAt?.getTime()).toBe(future.getTime());
    expect(after.lastScheduledRunAt).toBeNull();
    const runs = await prisma.reportRun.findMany();
    expect(runs).toHaveLength(0);
  });

  // Bug B regression: even if `runReport` errors before its own finally
  // (or — more commonly — its catch block runs), the scheduler must still
  // write `lastScheduledRunAt = now` and advance `nextScheduledRunAt`,
  // because the dispatcher DID attempt a fire. Without that write, the
  // staleness alert keeps reading the stale value indefinitely.
  test("advances nextScheduledRunAt and sets lastScheduledRunAt even when runReport errors", async () => {
    const due = new Date(Date.now() - 60 * 1000);
    const report = await prisma.report.create({
      data: {
        ...REPORT_DEFAULTS,
        title: "Always failing",
        nextScheduledRunAt: due,
        createdTime: new Date(),
        updatedTime: new Date(),
      },
    });

    const now = new Date();
    await runDueReports({ prisma, now });

    const after = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(after.nextScheduledRunAt?.getTime()).toBeGreaterThan(now.getTime());
    expect(after.lastScheduledRunAt?.getTime()).toBe(now.getTime());

    // Re-running the dispatcher in the same tick must NOT double-fire.
    const second = await runDueReports({ prisma, now });
    expect(second).toHaveLength(0);
  });

  test("freshness gauge is not set when a scheduled run errored", async () => {
    const due = new Date(Date.now() - 60 * 1000);
    const report = await prisma.report.create({
      data: {
        ...REPORT_DEFAULTS,
        title: "Will not update the gauge",
        nextScheduledRunAt: due,
        createdTime: new Date(),
        updatedTime: new Date(),
      },
    });

    // Manually pre-seed the gauge to a known epoch value. The runner is
    // expected to throw (no data in `competition_rank`), so the gauge
    // must NOT advance — that's how a MANUAL run is prevented from
    // silencing the missed-schedule alert.
    scoutScheduledReportLastSuccessTimestamp.set(
      {
        report_id: report.id.toString(),
        system_source: "USER",
        title: report.title,
      },
      42,
    );

    await runDueReports({ prisma });

    const snapshot = await scoutScheduledReportLastSuccessTimestamp.get();
    const value =
      snapshot.values.find((v) => v.labels.report_id === report.id.toString())
        ?.value ?? null;
    expect(value).toBe(42);
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.reportRun.deleteMany());
  await deleteIfExists(() => prisma.report.deleteMany());
}
