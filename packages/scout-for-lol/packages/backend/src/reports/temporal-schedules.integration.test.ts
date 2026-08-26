import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  enqueueReportScheduleDeletion,
  enqueueReportScheduleUpsert,
} from "#src/reports/temporal-schedules.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("report-temporal-schedules");

beforeEach(async () => {
  await prisma.reportScheduleOutbox.deleteMany();
  await prisma.reportRun.deleteMany();
  await prisma.report.deleteMany();
});

afterAll(async () => {
  await prisma.reportScheduleOutbox.deleteMany();
  await prisma.reportRun.deleteMany();
  await prisma.report.deleteMany();
  await prisma.$disconnect();
});

test("commits every report revision with its schedule outbox row", async () => {
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        serverId: testGuildId("880000000000000001"),
        ownerId: testAccountId("880000000000000002"),
        channelId: testChannelId("880000000000000003"),
        title: "Temporal report",
        queryText:
          "SELECT player, games FROM match GROUP BY player RENDER table",
        cronExpression: "0 8 * * *",
        scheduleTimezone: "America/Los_Angeles",
        createdTime: new Date(),
        updatedTime: new Date(),
      },
    });
    await enqueueReportScheduleUpsert(tx, created.id, created.revision);
    return created;
  });

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.report.update({
      where: { id: report.id },
      data: {
        cronExpression: "30 8 * * *",
        revision: { increment: 1 },
        updatedTime: new Date(),
      },
    });
    await enqueueReportScheduleUpsert(tx, next.id, next.revision);
    return next;
  });

  expect(updated.revision).toBe(report.revision + 1);
  expect(
    await prisma.reportScheduleOutbox.findMany({
      orderBy: { revision: "asc" },
      select: { reportId: true, revision: true, operation: true },
    }),
  ).toEqual([
    { reportId: report.id, revision: 1, operation: "UPSERT" },
    { reportId: report.id, revision: 2, operation: "UPSERT" },
  ]);
});

test("retains a deletion tombstone after the report row is gone", async () => {
  const report = await prisma.report.create({
    data: {
      serverId: testGuildId("880000000000000011"),
      ownerId: testAccountId("880000000000000012"),
      channelId: testChannelId("880000000000000013"),
      title: "Deleted report",
      queryText: "SELECT player, games FROM match GROUP BY player RENDER table",
      cronExpression: "0 8 * * *",
      scheduleTimezone: "UTC",
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });

  await prisma.$transaction(async (tx) => {
    await enqueueReportScheduleDeletion(tx, report.id, report.revision + 1);
    await tx.report.delete({ where: { id: report.id } });
  });

  expect(
    await prisma.report.findUnique({ where: { id: report.id } }),
  ).toBeNull();
  expect(
    await prisma.reportScheduleOutbox.findFirstOrThrow({
      where: { reportId: report.id },
      select: { revision: true, operation: true },
    }),
  ).toEqual({ revision: report.revision + 1, operation: "DELETE" });
});
