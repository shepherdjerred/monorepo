import { describe, expect, test, beforeEach } from "bun:test";
import {
  recordPermissionError,
  recordSuccessfulSend,
  getAbandonedGuilds,
  markGuildAsNotified,
  cleanupOldErrorRecords,
} from "@shepherdjerred/scout-backend/database/guild-permission-errors.ts";
import { DiscordChannelIdSchema, DiscordGuildIdSchema } from "@shepherdjerred/scout-data";
import { testGuildId, testChannelId } from "@shepherdjerred/scout-backend/testing/test-ids.ts";
import { createTestDatabase } from "@shepherdjerred/scout-backend/testing/test-database.ts";

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
      errorType: "proactive_check",
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
    expect(record?.errorType).toBe("proactive_check");
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
      errorType: "proactive_check",
    });

    // Second error
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("456000000"),
      errorType: "api_error",
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
    expect(record?.errorType).toBe("api_error"); // Updates to latest error type
  });

  test("tracks separate errors for different channels in same guild", async () => {
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("1000000001"),
      errorType: "proactive_check",
    });
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("2000000002"),
      errorType: "proactive_check",
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
      errorType: "proactive_check",
    });
    await recordPermissionError(prisma, {
      serverId: testGuildId("12300000000"),
      channelId: testChannelId("456000000"),
      errorType: "api_error",
    });

    // Record successful send
    await recordSuccessfulSend(prisma, testGuildId("12300000000"), testChannelId("456000000"));

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
    await recordSuccessfulSend(prisma, testGuildId("12300000000"), testChannelId("456000000"));

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

describe("getAbandonedGuilds", () => {
  test("finds guilds with 7+ days of consecutive errors", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Create error record from 8 days ago
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("00"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 50,
      },
    });

    const abandoned = await getAbandonedGuilds(prisma, 7);

    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.serverId).toBe(testGuildId("00"));
    expect(abandoned[0]?.errorCount).toBe(50);
  });

  test("does not find guilds with recent errors (< 7 days)", async () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("2000000001"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: fiveDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 10,
      },
    });

    const abandoned = await getAbandonedGuilds(prisma, 7);

    expect(abandoned).toHaveLength(0);
  });

  test("does not find guilds with recent successful sends", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("00"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 5,
        lastSuccessfulSend: yesterday, // Recent success
      },
    });

    const abandoned = await getAbandonedGuilds(prisma, 7);

    expect(abandoned).toHaveLength(0);
  });

  test("does not find guilds already notified", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("0"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 50,
        ownerNotified: true,
      },
    });

    const abandoned = await getAbandonedGuilds(prisma, 7);

    expect(abandoned).toHaveLength(0);
  });

  test("aggregates multiple channels for same guild", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Multiple channels with errors in same guild
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("3000000001"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 20,
      },
    });

    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("3000000001"),
        channelId: testChannelId("2000000002"),
        errorType: "api_error",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 15,
      },
    });

    const abandoned = await getAbandonedGuilds(prisma, 7);

    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.serverId).toBe(testGuildId("3000000001"));
    expect(abandoned[0]?.errorCount).toBe(35); // 20 + 15
  });

  test("respects custom minDays parameter", async () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("00"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: threeDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 10,
      },
    });

    // Not found with 7-day threshold
    const abandonedSeven = await getAbandonedGuilds(prisma, 7);
    expect(abandonedSeven).toHaveLength(0);

    // Found with 2-day threshold
    const abandonedTwo = await getAbandonedGuilds(prisma, 2);
    expect(abandonedTwo).toHaveLength(1);
  });

  test("does not find guilds with at least one working channel", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Channel 1: Has errors for 8+ days
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("4000000001"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 50,
      },
    });

    // Channel 2: Working fine (recent successful send)
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("4000000001"),
        channelId: testChannelId("2000000002"),
        errorType: "none",
        firstOccurrence: yesterday,
        lastOccurrence: yesterday,
        consecutiveErrorCount: 0,
        lastSuccessfulSend: yesterday,
      },
    });

    const abandoned = await getAbandonedGuilds(prisma, 7);

    // Guild should NOT be abandoned because channel 2 is working
    expect(abandoned).toHaveLength(0);
  });

  test("finds guilds where ALL channels have errors", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Channel 1: Has errors
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("5000000001"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 30,
      },
    });

    // Channel 2: Also has errors
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("5000000001"),
        channelId: testChannelId("2000000002"),
        errorType: "api_error",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 20,
      },
    });

    const abandoned = await getAbandonedGuilds(prisma, 7);

    // Guild SHOULD be abandoned because ALL channels have errors
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.serverId).toBe(testGuildId("5000000001"));
    expect(abandoned[0]?.errorCount).toBe(50); // 30 + 20
  });
});

describe("markGuildAsNotified", () => {
  test("marks all error records for a guild as notified", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Create multiple error records for same guild
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("12300000000"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 10,
      },
    });

    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("12300000000"),
        channelId: testChannelId("2000000002"),
        errorType: "api_error",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 5,
      },
    });

    await markGuildAsNotified(prisma, testGuildId("12300000000"));

    const records = await prisma.guildPermissionError.findMany({
      where: { serverId: testGuildId("12300000000") },
    });

    expect(records).toHaveLength(2);
    expect(records.every((r) => r.ownerNotified)).toBe(true);
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
      errorType: "proactive_check",
    });
    let record = await prisma.guildPermissionError.findUnique({
      where: { serverId_channelId: { serverId, channelId } },
    });
    expect(record?.consecutiveErrorCount).toBe(1);

    // 2. More errors accumulate
    await recordPermissionError(prisma, {
      serverId,
      channelId,
      errorType: "api_error",
    });
    await recordPermissionError(prisma, {
      serverId,
      channelId,
      errorType: "api_error",
    });
    record = await prisma.guildPermissionError.findUnique({
      where: { serverId_channelId: { serverId, channelId } },
    });
    expect(record?.consecutiveErrorCount).toBe(3);

    // 3. Successful send resets count
    await recordSuccessfulSend(prisma, DiscordGuildIdSchema.parse(serverId), DiscordChannelIdSchema.parse(channelId));
    record = await prisma.guildPermissionError.findUnique({
      where: { serverId_channelId: { serverId, channelId } },
    });
    expect(record?.consecutiveErrorCount).toBe(0);
    expect(record?.lastSuccessfulSend).toBeDefined();
  });

  test("abandoned guild detection workflow", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Create error that started 8 days ago
    await prisma.guildPermissionError.create({
      data: {
        serverId: testGuildId("1230000"),
        channelId: testChannelId("1000000001"),
        errorType: "proactive_check",
        firstOccurrence: eightDaysAgo,
        lastOccurrence: new Date(),
        consecutiveErrorCount: 50,
      },
    });

    // 1. Should be detected as abandoned
    const abandoned = await getAbandonedGuilds(prisma, 7);
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.serverId).toBe(testGuildId("1230000"));

    // 2. Mark as notified
    await markGuildAsNotified(prisma, testGuildId("1230000"));

    // 3. Should no longer appear in abandoned list
    const stillAbandoned = await getAbandonedGuilds(prisma, 7);
    expect(stillAbandoned).toHaveLength(0);
  });
});
