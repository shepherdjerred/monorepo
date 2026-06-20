import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { updateUsageMetrics } from "#src/metrics/usage.ts";
import {
  guildSendBlockedTotal,
  competitionUnhealthyTotal,
  guildInfo,
} from "#src/metrics/guild-health.ts";
import {
  testGuildId,
  testAccountId,
  testChannelId,
} from "#src/testing/test-ids.ts";
import { CompetitionIdSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("usage-metrics-test");

const guild = testGuildId("630000000000000003");

async function totalValue(metric: {
  get: () => Promise<{ values: { value: number }[] }>;
}): Promise<number> {
  const m = await metric.get();
  return m.values[0]?.value ?? 0;
}

beforeEach(async () => {
  await prisma.guildPermissionError.deleteMany();
  await prisma.report.deleteMany();
  await prisma.guildInstall.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("updateUsageMetrics - guild health gauges", () => {
  test("counts delivery-blocked guilds and unhealthy competitions, and exposes names", async () => {
    const now = new Date();

    // A guild with an active send-failure streak.
    await prisma.guildPermissionError.create({
      data: {
        serverId: guild,
        channelId: testChannelId("100"),
        errorType: "api_error",
        firstOccurrence: now,
        lastOccurrence: now,
        consecutiveErrorCount: 5,
      },
    });

    // An active competition whose leaderboard report last failed.
    await prisma.report.create({
      data: {
        serverId: guild,
        ownerId: testAccountId("900"),
        channelId: testChannelId("100"),
        title: "Ranked",
        queryText: "SELECT 1",
        cronExpression: "0 0 * * *",
        isEnabled: true,
        isSystemManaged: true,
        systemSource: "COMPETITION",
        sourceCompetitionId: CompetitionIdSchema.parse(5),
        lastRunStatus: "FAILED",
        createdTime: now,
        updatedTime: now,
      },
    });

    // Install record for the name join.
    await prisma.guildInstall.create({
      data: {
        serverId: guild,
        serverName: "Guild Three",
        ownerDiscordId: testAccountId("900"),
        addedByDiscordId: testAccountId("900"),
        memberCount: 10,
        installedAt: now,
      },
    });

    await updateUsageMetrics(prisma);

    expect(await totalValue(guildSendBlockedTotal)).toBe(1);
    expect(await totalValue(competitionUnhealthyTotal)).toBe(1);

    const info = await guildInfo.get();
    expect(
      info.values.some((v) => v.labels.server_name === "Guild Three"),
    ).toBe(true);
  });

  test("reports zero when everything is healthy", async () => {
    await updateUsageMetrics(prisma);
    expect(await totalValue(guildSendBlockedTotal)).toBe(0);
    expect(await totalValue(competitionUnhealthyTotal)).toBe(0);
  });
});
