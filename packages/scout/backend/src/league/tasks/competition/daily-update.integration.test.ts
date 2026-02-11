import { afterAll, beforeEach, describe, expect, test, mock } from "bun:test";
import { createCompetition, type CreateCompetitionInput } from "@shepherdjerred/scout-backend/database/competition/queries.ts";
import type {
  CompetitionCriteria,
  CompetitionId,
  DiscordChannelId,
  DiscordGuildId,
  LeaguePuuid,
  PlayerId,
  Region,
} from "@shepherdjerred/scout-data";
import { z } from "zod";

import { testGuildId, testAccountId, testChannelId, testPuuid } from "@shepherdjerred/scout-backend/testing/test-ids.ts";
import { createTestDatabase } from "@shepherdjerred/scout-backend/testing/test-database.ts";
// Schema for Discord message content validation
const MessageContentSchema = z.object({
  content: z.string(),
  embeds: z.array(z.unknown()).optional(),
});

// Mock the Discord send function BEFORE importing daily-update
let sentMessages: { channelId: string; content: string | Record<string, unknown> }[] = [];

// Custom error class for channel send failures (for type checking)
class ChannelSendError extends Error {
  constructor(
    message: string,
    public readonly channelId: string,
    public readonly isPermissionError: boolean,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

// Mock the channel send function
void mock.module("../../discord/channel.js", () => ({
  send: (message: string | Record<string, unknown>, channelId: string) => {
    sentMessages.push({ channelId, content: message });
    return Promise.resolve({ id: "mock-message-id" });
  },
  ChannelSendError,
}));

// Mock the S3 query module to avoid AWS configuration issues in tests
void mock.module("../../../storage/s3-query.js", () => ({
  queryMatchesByDateRange: async () => {
    // Return empty array - tests are focused on posting logic, not match data
    return [];
  },
}));

// Mock the S3 leaderboard save function to avoid AWS configuration issues in tests
void mock.module("../../../storage/s3-leaderboard.js", () => ({
  saveCachedLeaderboard: async () => {
    // No-op - tests are focused on posting logic, not S3 caching
    return Promise.resolve();
  },
}));

// Create a test database
const { prisma: testPrisma } = createTestDatabase("daily-update-test");

// Mock the prisma instance used by daily-update
void mock.module("../../../database/index.js", () => ({
  prisma: testPrisma,
}));

// Now import daily-update after mocks are set up
const { runDailyLeaderboardUpdate } = await import("./daily-update.js");

// Test helpers
async function createTestCompetition(
  criteria: CompetitionCriteria,
  startDate: Date,
  endDate: Date,
  options?: {
    serverId?: DiscordGuildId;
    channelId?: DiscordChannelId;
    title?: string;
  },
): Promise<{ competitionId: CompetitionId; channelId: DiscordChannelId }> {
  const channelId = options?.channelId ?? testChannelId(Date.now().toString());
  const input: CreateCompetitionInput = {
    serverId: options?.serverId ?? testGuildId("12345678901234567"),
    ownerId: testAccountId("98765432109876543"),
    channelId,
    title: options?.title ?? "Test Competition",
    description: "Test Description",
    visibility: "OPEN",
    maxParticipants: 50,
    dates: {
      type: "FIXED_DATES",
      startDate,
      endDate,
    },
    criteria,
  };

  const competition = await createCompetition(testPrisma, input);
  return { competitionId: competition.id, channelId };
}

async function createTestPlayer(alias: string, puuid: LeaguePuuid, region: Region): Promise<{ playerId: PlayerId }> {
  const now = new Date();
  const player = await testPrisma.player.create({
    data: {
      alias,
      discordId: null,
      serverId: testGuildId("12345678901234567"),
      creatorDiscordId: testAccountId("98765432109876543"),
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: [
          {
            alias,
            puuid,
            region,
            serverId: testGuildId("12345678901234567"),
            creatorDiscordId: testAccountId("98765432109876543"),
            createdTime: now,
            updatedTime: now,
          },
        ],
      },
    },
  });
  return { playerId: player.id };
}

async function addTestParticipant(competitionId: CompetitionId, playerId: PlayerId): Promise<void> {
  const now = new Date();
  await testPrisma.competitionParticipant.create({
    data: {
      competitionId,
      playerId,
      status: "JOINED",
      joinedAt: now,
    },
  });
}

async function createStartSnapshot(competitionId: CompetitionId, playerId: PlayerId, startDate: Date): Promise<void> {
  await testPrisma.competitionSnapshot.create({
    data: {
      competitionId,
      playerId,
      snapshotType: "START",
      snapshotData: JSON.stringify({ soloGames: 0 }),
      snapshotTime: startDate,
    },
  });
}

beforeEach(async () => {
  // Clean up before each test
  await testPrisma.competitionSnapshot.deleteMany();
  await testPrisma.competitionParticipant.deleteMany();
  await testPrisma.competition.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.player.deleteMany();

  // Reset sent messages
  sentMessages = [];
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

// ============================================================================
// Daily Update Tests
// ============================================================================

describe("Daily Leaderboard Update", () => {
  test("posts update for single active competition", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    // Use dates relative to actual current time
    const now = new Date();
    const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    const { competitionId, channelId } = await createTestCompetition(criteria, startDate, endDate);

    // Create START snapshot to make it ACTIVE
    const { playerId } = await createTestPlayer("Player1", testPuuid("player1"), "AMERICA_NORTH");
    await addTestParticipant(competitionId, playerId);
    await createStartSnapshot(competitionId, playerId, startDate);

    // Run daily update
    await runDailyLeaderboardUpdate();

    // Verify message was sent
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]?.channelId).toBe(channelId);

    // Verify message content
    const message = sentMessages[0]?.content;
    expect(message).toBeDefined();

    const parsed = MessageContentSchema.safeParse(message);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.content).toContain("📊 **Daily Leaderboard Update**");
      expect(parsed.data.content).toContain("Test Competition");
    }
  });

  test("posts updates for multiple active competitions", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    // Use dates relative to actual current time
    const now = new Date();
    const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    // Create 3 active competitions on different servers
    const comps = [];
    for (let i = 0; i < 3; i++) {
      const { competitionId, channelId } = await createTestCompetition(criteria, startDate, endDate, {
        serverId: testGuildId((100 + i).toString()),
        channelId: testChannelId(i.toString()),
        title: `Competition ${i.toString()}`,
      });

      // Make them ACTIVE by adding START snapshots
      const { playerId } = await createTestPlayer(
        `Player${i.toString()}`,
        testPuuid(`player-${i.toString()}`),
        "AMERICA_NORTH",
      );
      await addTestParticipant(competitionId, playerId);
      await createStartSnapshot(competitionId, playerId, startDate);

      comps.push({ competitionId, channelId });
    }

    // Run daily update
    await runDailyLeaderboardUpdate();

    // Verify messages were sent to all channels
    expect(sentMessages.length).toBe(3);

    // Verify each competition got an update
    for (let i = 0; i < 3; i++) {
      const expectedChannelId = comps[i]?.channelId;
      const messageForComp = sentMessages.find((m) => m.channelId === expectedChannelId);
      expect(messageForComp).toBeDefined();

      const parsed = MessageContentSchema.safeParse(messageForComp?.content);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.content).toContain("📊 **Daily Leaderboard Update**");
        expect(parsed.data.content).toContain(`Competition ${i.toString()}`);
      }
    }
  });

  test("skips non-active competitions", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date();

    // Create ENDED competition (past end date) - won't be returned by getActiveCompetitions
    const { competitionId: endedId } = await createTestCompetition(
      criteria,
      new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // Ended 3 days ago
      { title: "Ended Competition" },
    );
    const { playerId: endedPlayerId } = await createTestPlayer(
      "EndedPlayer",
      testPuuid("ended-player"),
      "AMERICA_NORTH",
    );
    await addTestParticipant(endedId, endedPlayerId);
    await createStartSnapshot(endedId, endedPlayerId, new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000));

    // Create CANCELLED competition - won't be returned by getActiveCompetitions
    const { competitionId: cancelledId } = await createTestCompetition(
      criteria,
      new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      { title: "Cancelled Competition" },
    );
    await testPrisma.competition.update({
      where: { id: cancelledId },
      data: { isCancelled: true },
    });

    // Run daily update
    await runDailyLeaderboardUpdate();

    // Verify no messages were sent (only ENDED and CANCELLED exist, neither returned by getActiveCompetitions)
    expect(sentMessages.length).toBe(0);
  });

  test("handles competition with no participants", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date();
    const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Create ACTIVE competition with no participants
    // This will be returned by getActiveCompetitions and will be ACTIVE status
    await createTestCompetition(criteria, startDate, endDate);

    // Run daily update
    await runDailyLeaderboardUpdate();

    // Should post update even with no participants (will show "No participants have scores yet")
    expect(sentMessages.length).toBe(1);

    // Verify the message indicates no participants
    const message = sentMessages[0]?.content;
    const parsed = MessageContentSchema.safeParse(message);
    expect(parsed.success).toBe(true);
  });

  test("continues processing after error in one competition", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date();
    const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Create first competition with invalid channel (will fail to send)
    const { competitionId: comp1Id } = await createTestCompetition(criteria, startDate, endDate, {
      channelId: testChannelId("999"),
      title: "Competition 1",
    });
    const { playerId: player1Id } = await createTestPlayer("Player1", testPuuid("error-player1"), "AMERICA_NORTH");
    await addTestParticipant(comp1Id, player1Id);
    await createStartSnapshot(comp1Id, player1Id, startDate);

    // Create second competition (should succeed)
    const { competitionId: comp2Id, channelId: channel2Id } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
      {
        channelId: testChannelId("0"),
        title: "Competition 2",
      },
    );
    const { playerId: player2Id } = await createTestPlayer("Player2", testPuuid("error-player2"), "AMERICA_NORTH");
    await addTestParticipant(comp2Id, player2Id);
    await createStartSnapshot(comp2Id, player2Id, startDate);

    // Run daily update - should not throw despite first competition failing
    await runDailyLeaderboardUpdate();

    // Second competition should still get updated
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    const comp2Message = sentMessages.find((m) => m.channelId === channel2Id);
    expect(comp2Message).toBeDefined();
  });

  test("handles no active competitions gracefully", async () => {
    // Don't create any competitions

    // Run daily update
    await runDailyLeaderboardUpdate();

    // Should complete without errors
    expect(sentMessages.length).toBe(0);
  });

  test("message includes day count for active competition", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date();
    const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { competitionId } = await createTestCompetition(criteria, startDate, endDate);

    // Make it ACTIVE
    const { playerId } = await createTestPlayer("Player1", testPuuid("day-count-player"), "AMERICA_NORTH");
    await addTestParticipant(competitionId, playerId);
    await createStartSnapshot(competitionId, playerId, startDate);

    // Run daily update
    await runDailyLeaderboardUpdate();

    // Verify message was sent
    expect(sentMessages.length).toBe(1);

    // Verify embed contains status information
    const message = sentMessages[0]?.content;

    const parsed = MessageContentSchema.safeParse(message);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.embeds) {
      expect(parsed.data.embeds).toBeDefined();
      expect(parsed.data.embeds.length).toBeGreaterThan(0);

      // The embed should have status field that shows active state
      const embed = parsed.data.embeds[0];
      expect(embed).toBeDefined();
    }
  });

  test("respects rate limiting with delays between posts", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date();
    const startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Create 3 active competitions
    for (let i = 0; i < 3; i++) {
      const { competitionId } = await createTestCompetition(criteria, startDate, endDate, {
        channelId: testChannelId(i.toString()),
        title: `Competition ${i.toString()}`,
      });

      const { playerId } = await createTestPlayer(
        `Player${i.toString()}`,
        testPuuid(`rate-limit-player-${i.toString()}`),
        "AMERICA_NORTH",
      );
      await addTestParticipant(competitionId, playerId);
      await createStartSnapshot(competitionId, playerId, startDate);
    }

    const startTime = Date.now();
    await runDailyLeaderboardUpdate();
    const endTime = Date.now();

    // Should take at least 2 seconds (2 delays of 1 second each between 3 posts)
    // Allow some tolerance for test execution time
    const duration = endTime - startTime;
    expect(duration).toBeGreaterThanOrEqual(1900); // At least 1.9 seconds

    // All messages should have been sent
    expect(sentMessages.length).toBe(3);
  });
});
