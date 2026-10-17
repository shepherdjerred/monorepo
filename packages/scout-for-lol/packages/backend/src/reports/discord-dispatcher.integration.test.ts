import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  recordCoreOutputDelivered: vi.fn(),
}));
vi.mock("#src/league/discord/channel.ts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "#src/league/discord/channel.ts",
  )),
  send: mocks.send,
}));
vi.mock("#src/analytics/guild-lifecycle.ts", () => ({
  recordCoreOutputDelivered: mocks.recordCoreOutputDelivered,
}));

const { deliverReportDispatch, deliverPendingReportDispatches } =
  await import("#src/reports/discord-dispatcher.ts");

const { prisma } = createTestDatabase("report-discord-dispatcher");
const installed = () => Promise.resolve(true);

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ id: "100000000000000001" });
  mocks.recordCoreOutputDelivered.mockResolvedValue(undefined);
  await prisma.report.deleteMany();
  await prisma.scoutEffectClaim.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function pendingRun() {
  const report = await prisma.report.create({
    data: {
      title: "Analytics fence",
      serverId: testGuildId("92001"),
      channelId: testChannelId("92002"),
      ownerId: testAccountId("92003"),
      queryText: "SELECT games FROM match_participants GROUP BY all",
      cronExpression: "0 0 * * *",
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
  const run = await prisma.reportRun.create({
    data: {
      reportId: report.id,
      serverId: report.serverId,
      trigger: "SCHEDULED",
      status: "SUCCESS",
      startedAt: new Date(),
      renderedContent: "Frozen report output",
      deliveryState: "PENDING",
      deliveryChannelId: report.channelId,
      deliveryServerId: report.serverId,
    },
  });
  return {
    report,
    run,
    dispatch: {
      report,
      result: {
        runId: run.id,
        rowsReturned: 1,
        rowsScanned: 1,
        output: { content: "Frozen report output", image: null },
      },
    },
  };
}

describe("report delivery analytics", () => {
  test("counts a delivered run once, however many times delivery is retried", async () => {
    const { dispatch, run } = await pendingRun();

    expect(
      await deliverReportDispatch(dispatch, "report_scheduled", "propagate", {
        isInstalled: installed,
        database: prisma,
      }),
    ).toBe(true);
    // A retried Activity re-enters with every chunk already delivered.
    expect(
      await deliverReportDispatch(dispatch, "report_scheduled", "propagate", {
        isInstalled: installed,
        database: prisma,
      }),
    ).toBe(true);

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.recordCoreOutputDelivered).toHaveBeenCalledTimes(1);
    expect(mocks.recordCoreOutputDelivered).toHaveBeenCalledWith(
      dispatch.report.serverId,
      "report_scheduled",
      { db: prisma },
    );
    expect(
      await prisma.reportRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ deliveryState: "DELIVERED", deliveryError: null });
  });

  test("does not repeat an event the previous build already recorded", async () => {
    // The previous build completed this claim right after recording the event
    // and lost the run before marking it DELIVERED.
    const { dispatch, run } = await pendingRun();
    await prisma.scoutEffectClaim.create({
      data: {
        key: `report-analytics:${run.id.toString()}`,
        kind: "report-analytics",
        state: "COMPLETED",
        completedAt: new Date(),
      },
    });

    expect(
      await deliverReportDispatch(dispatch, "report_scheduled", "propagate", {
        isInstalled: installed,
        database: prisma,
      }),
    ).toBe(true);

    expect(mocks.recordCoreOutputDelivered).not.toHaveBeenCalled();
    expect(
      await prisma.reportRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ deliveryState: "DELIVERED" });
  });

  test("the reconciliation path records the same single event", async () => {
    const { report, run } = await pendingRun();

    await deliverPendingReportDispatches(
      { reportId: report.id, trigger: "SCHEDULED", isInstalled: installed },
      prisma,
    );
    // The run is no longer PENDING, so a second sweep finds nothing to do.
    await deliverPendingReportDispatches(
      { reportId: report.id, trigger: "SCHEDULED", isInstalled: installed },
      prisma,
    );

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.recordCoreOutputDelivered).toHaveBeenCalledTimes(1);
    expect(
      await prisma.reportRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ deliveryState: "DELIVERED" });
  });

  test("records nothing for a run whose send outcome is unknown", async () => {
    const { dispatch, run } = await pendingRun();
    mocks.send.mockRejectedValueOnce(
      new Error("response lost after Discord accepted"),
    );

    expect(
      await deliverReportDispatch(dispatch, "report_scheduled", "isolate", {
        isInstalled: installed,
        database: prisma,
      }),
    ).toBe(false);

    expect(mocks.recordCoreOutputDelivered).not.toHaveBeenCalled();
    expect(
      await prisma.reportRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ deliveryState: "UNKNOWN" });
  });
});
