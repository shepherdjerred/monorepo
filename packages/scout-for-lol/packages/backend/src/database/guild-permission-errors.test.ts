import { describe, expect, test, beforeEach } from "bun:test";
import {
  recordPermissionError,
  recordSuccessfulSend,
  cleanupOldErrorRecords,
} from "#src/database/guild-permission-errors.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { testGuildId, testChannelId } from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

// Create a test database
const { prisma } = createTestDatabase("guild-errors-test");

beforeEach(async () => {
  // Clean up all records before each test
  await prisma.guildPermissionError.deleteMany();
});

describe("recordPermissionError", () => {
  test("creates new error record on first occurrence", async () => {
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("456000000"),
      errorType: "permission",
      errorReason: "Missing Send Messages",
    });

    const record = await prisma.guildPermissionError.findUnique({
      where: {
        serverId_channelId: {
          serverId: testGuildId("12300000000"),
          channelId: testChannelId("456000000"),
        },
      },
    });

    expect(record).toBeDefined();
    expect(record?.serverId).toBe(testGuildId("12300000000"));
    expect(record?.channelId).toBe(testChannelId("456000000"));
    expect(record?.errorType).toBe("permission");
    expect(record?.errorReason).toBe("Missing Send Messages");
    expect(record?.consecutiveErrorCount).toBe(1);
    expect(record?.firstOccurrence).toBeDefined();
    expect(record?.lastOccurrence).toBeDefined();
  });

  test("increments error count on subsequent occurrences", async () => {
    // First error
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("456000000"),
      errorType: "permission",
    });

    // Second error
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("456000000"),
      errorType: "channel_missing",
    });

    const record = await prisma.guildPermissionError.findUnique({
      where: {
        serverId_channelId: {
          serverId: testGuildId("12300000000"),
          channelId: testChannelId("456000000"),
        },
      },
    });

    expect(record?.consecutiveErrorCount).toBe(2);
    expect(record?.errorType).toBe("channel_missing"); // Updates to latest error type
  });

  test("tracks separate errors for different channels in same guild", async () => {
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("1000000001"),
      errorType: "permission",
    });
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("2000000002"),
      errorType: "permission",
    });

    const errors = await prisma.guildPermissionError.findMany({
      where: { serverId: testGuildId("12300000000") },
    });

    expect(errors).toHaveLength(2);
  });
});

describe("recordSuccessfulSend", () => {
  test("resets error count when called", async () => {
    // Create some errors
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("456000000"),
      errorType: "permission",
    });
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("456000000"),
      errorType: "channel_missing",
    });

    // Record successful send
    await recordSuccessfulSend(
      prisma,
      testGuildId("12300000000"),
      testChannelId("456000000"),
    );

    const record = await prisma.guildPermissionError.findUnique({
      where: {
        serverId_channelId: {
          serverId: testGuildId("12300000000"),
          channelId: testChannelId("456000000"),
        },
      },
    });

    expect(record?.consecutiveErrorCount).toBe(0);
    expect(record?.lastSuccessfulSend).toBeDefined();
  });

  test("creates record with successful send if none exists", async () => {
    await recordSuccessfulSend(
      prisma,
      testGuildId("12300000000"),
      testChannelId("456000000"),
    );

    const record = await prisma.guildPermissionError.findUnique({
      where: {
        serverId_channelId: {
          serverId: testGuildId("12300000000"),
          channelId: testChannelId("456000000"),
        },
      },
    });

    expect(record?.consecutiveErrorCount).toBe(0);
    expect(record?.lastSuccessfulSend).toBeDefined();
  });
});

describe("cleanupOldErrorRecords", () => {
  test("removes records with successful sends older than 30 days", async () => {
    const fortyDaysAgo = new Date();
    fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

    // Old resolved error
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("00000000"),
        channelId: testChannelId("1000000001"),
        errorType: "none",
        firstOccurrence: fortyDaysAgo,
        lastOccurrence: fortyDaysAgo,
        consecutiveErrorCount: 0,
        lastSuccessfulSend: fortyDaysAgo,
      },
    });

    const deletedCount = await cleanupOldErrorRecords(prisma);

    expect(deletedCount).toBe(1);

    const remaining = await prisma.guildPermissionError.findMany();
    expect(remaining).toHaveLength(0);
  });

  test("keeps recent resolved errors", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("00000"),
        channelId: testChannelId("1000000001"),
        errorType: "none",
        firstOccurrence: yesterday,
        lastOccurrence: yesterday,
        consecutiveErrorCount: 0,
        lastSuccessfulSend: yesterday,
      },
    });

    const deletedCount = await cleanupOldErrorRecords(prisma);

    expect(deletedCount).toBe(0);

    const remaining = await prisma.guildPermissionError.findMany();
    expect(remaining).toHaveLength(1);
  });

  test("keeps unresolved errors regardless of age", async () => {
    const fortyDaysAgo = new Date();
    fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

    // Old but still has errors
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("4000000001"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: fortyDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 100, // Still has errors
      },
    });

    const deletedCount = await cleanupOldErrorRecords(prisma);

    expect(deletedCount).toBe(0);

    const remaining = await prisma.guildPermissionError.findMany();
    expect(remaining).toHaveLength(1);
  });
});

describe("Permission Error Workflow", () => {
  test("full workflow: error -> more errors -> success -> reset", async () => {
    const serverId = testGuildId("000");
    const channelId = testChannelId("0");

    // 1. First error
    await recordPermissionError(prisma, {
      serverId,
      channelId,
      errorType: "permission",
    });
    let record = await prisma.guildPermissionError.findUnique({
      where: { serverId_channelId: { serverId, channelId } },
    });
    expect(record?.consecutiveErrorCount).toBe(1);

    // 2. More errors accumulate
    await recordPermissionError(prisma, {
      serverId,
      channelId,
      errorType: "channel_missing",
    });
    await recordPermissionError(prisma, {
      serverId,
      channelId,
      errorType: "channel_missing",
    });
    record = await prisma.guildPermissionError.findUnique({
      where: { serverId_channelId: { serverId, channelId } },
    });
    expect(record?.consecutiveErrorCount).toBe(3);

    // 3. Successful send resets count
    await recordSuccessfulSend(
      prisma,
      DiscordGuildIdSchema.parse(serverId),
      DiscordChannelIdSchema.parse(channelId),
    );
    record = await prisma.guildPermissionError.findUnique({
      where: { serverId_channelId: { serverId, channelId } },
    });
    expect(record?.consecutiveErrorCount).toBe(0);
    expect(record?.lastSuccessfulSend).toBeDefined();
  });
});

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// Seed a GuildPermissionError row in a specific escalation state.
async function seedEscalationRow(opts: {
  serverId: ReturnType<typeof testGuildId>;
  channelId: ReturnType<typeof testChannelId>;
  notificationStage: number;
  lastNotifiedAt: Date | null;
  firstOccurrence?: Date;
  consecutiveErrorCount?: number;
}) {
  await prisma.guildPermissionError.create({
    data: {
      serverId: opts.serverId,
      channelId: opts.channelId,
      errorType: "api_error",
      firstOccurrence: opts.firstOccurrence ?? new Date(),
      lastOccurrence: new Date(),
      consecutiveErrorCount: opts.consecutiveErrorCount ?? 1,
      notificationStage: opts.notificationStage,
      lastNotifiedAt: opts.lastNotifiedAt,
    },
  });
}

describe("recordPermissionError - escalation decisions", () => {
  test("first failure of a streak returns 'immediate', then 'none' until the next stage", async () => {
    const serverId = testGuildId("99001");
    const channelId = testChannelId("99002");

    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("immediate");

    // Same stage, no time elapsed → no further notification.
    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("none");
  });

  test("advances to 'week' once ~1 week has passed since the immediate DM", async () => {
    const serverId = testGuildId("99010");
    const channelId = testChannelId("99011");
    await seedEscalationRow({
      serverId,
      channelId,
      notificationStage: 1,
      lastNotifiedAt: daysAgo(8),
      consecutiveErrorCount: 20,
    });

    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("week");
  });

  test("advances to 'month' once ~1 month has passed since the week DM, then stays silent", async () => {
    const serverId = testGuildId("99020");
    const channelId = testChannelId("99021");
    await seedEscalationRow({
      serverId,
      channelId,
      notificationStage: 2,
      lastNotifiedAt: daysAgo(31),
      consecutiveErrorCount: 60,
    });

    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("month");

    // Stage 3 is terminal — no more notifications.
    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("none");
  });

  test("a successful send resets the streak back to 'immediate'", async () => {
    const serverId = testGuildId("99030");
    const channelId = testChannelId("99031");

    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("immediate");

    await recordSuccessfulSend(prisma, serverId, channelId);

    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("immediate");
  });

  test("EXISTING guild: a pre-feature mid-streak row (stage 0, old firstOccurrence, high count) returns 'immediate', not 'month'", async () => {
    const serverId = testGuildId("99040");
    const channelId = testChannelId("99041");
    // Simulates a row that existed before this feature deployed: lots of errors,
    // first failure long ago, but never escalated (stage 0 / lastNotifiedAt null).
    await seedEscalationRow({
      serverId,
      channelId,
      notificationStage: 0,
      lastNotifiedAt: null,
      firstOccurrence: daysAgo(90),
      consecutiveErrorCount: 138,
    });

    expect(
      await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: "channel_missing",
      }),
    ).toBe("immediate");
  });
});
