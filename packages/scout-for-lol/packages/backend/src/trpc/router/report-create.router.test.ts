import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

// Offline tRPC harness: real router + audit writes, no Discord OAuth, no real
// Discord backing. See src/testing/test-trpc-caller.ts.
const trpc = await createOfflineTrpcHarness("trpc-report-create-test");
const { prisma: testPrisma } = trpc;

const guildId = DiscordGuildIdSchema.parse("100000000000000021");
const channelId = DiscordChannelIdSchema.parse("200000000000000021");
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000021");

const QUERY_TEXT =
  "SELECT player, COUNT(*) AS games FROM match_participants GROUP BY player RENDER table";

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    guildId,
    channelId,
    title: "Weekly games",
    description: null,
    queryText: QUERY_TEXT,
    ...overrides,
  };
}

beforeEach(async () => {
  await testPrisma.auditLog.deleteMany();
  await testPrisma.reportScheduleOutbox.deleteMany();
  await testPrisma.report.deleteMany();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("report.create", () => {
  test("creates the report and writes a REPORT_CREATE audit row", async () => {
    const report = await trpc
      .authedCaller(actorDiscordId)
      .report.create(createInput());

    expect(report.serverId).toBe(guildId);
    expect(report.queryText).toBe(QUERY_TEXT);

    const audits = await testPrisma.auditLog.findMany({
      where: { serverId: guildId },
    });
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit).toBeDefined();
    if (audit === undefined) return;
    expect(audit.action).toBe("REPORT_CREATE");
    expect(audit.actorDiscordId).toBe(actorDiscordId);
    expect(audit.targetChannelId).toBe(channelId);
    expect(JSON.parse(audit.payload)).toMatchObject({
      reportId: report.id,
      title: "Weekly games",
      queryText: QUERY_TEXT,
    });
  });

  test("update edits fields, bumps revision and enqueues the schedule (via the shared service)", async () => {
    const created = await trpc
      .authedCaller(actorDiscordId)
      .report.create(createInput());
    await testPrisma.reportScheduleOutbox.deleteMany();

    const updated = await trpc.authedCaller(actorDiscordId).report.update({
      guildId,
      reportId: created.id,
      title: "Renamed",
      queryText:
        "SELECT player, COUNT(*) AS wins FROM match_participants GROUP BY player RENDER table",
    });

    expect(updated.title).toBe("Renamed");
    expect(updated.queryText).toContain("wins");
    expect(updated.revision).toBe(created.revision + 1);
    expect(await testPrisma.reportScheduleOutbox.count()).toBe(1);
    // The web update path writes no audit row, as before the extraction.
    expect(
      await testPrisma.auditLog.count({
        where: { serverId: guildId, action: "REPORT_UPDATE" },
      }),
    ).toBe(0);
  });

  test("setEnabled and delete still work through the shared service", async () => {
    const created = await trpc
      .authedCaller(actorDiscordId)
      .report.create(createInput());

    const disabled = await trpc
      .authedCaller(actorDiscordId)
      .report.setEnabled({ guildId, reportId: created.id, isEnabled: false });
    expect(disabled.isEnabled).toBe(false);
    expect(disabled.nextScheduledRunAt).toBeNull();

    await expect(
      trpc
        .authedCaller(actorDiscordId)
        .report.delete({ guildId, reportId: created.id }),
    ).resolves.toEqual({ deleted: true });
    expect(
      await testPrisma.report.count({ where: { serverId: guildId } }),
    ).toBe(0);
  });

  test("an uncompilable query is rejected and leaves no report or audit row", async () => {
    await expect(
      trpc
        .authedCaller(actorDiscordId)
        .report.create(createInput({ queryText: "SELECT nonsense FROM" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(
      await testPrisma.report.count({ where: { serverId: guildId } }),
    ).toBe(0);
    expect(
      await testPrisma.auditLog.count({ where: { serverId: guildId } }),
    ).toBe(0);
  });
});
