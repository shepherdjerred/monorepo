import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { PrismaClient } from "@shepherdjerred/scout-backend/generated/prisma/client/index.js";
import { pruneOrphanedPlayers } from "@shepherdjerred/scout-backend/league/tasks/cleanup/prune-players.ts";
import { testGuildId, testAccountId, testChannelId, testPuuid } from "@shepherdjerred/scout-backend/testing/test-ids.ts";
import { CompetitionIdSchema, type CompetitionId } from "@shepherdjerred/scout-data";
import { createTestDatabase } from "@shepherdjerred/scout-backend/testing/test-database.ts";

// Mark these tests as serial since they create temporary databases
// and have timing constraints. Running them concurrently would slow them down.
/**
 * Create test competition
 */
async function createTestCompetition(prisma: PrismaClient, now: Date) {
  return prisma.competition.create({
    data: {
      serverId: testGuildId("1000000001"),
      ownerId: testAccountId("1000000000000"),
      title: "Test Competition",
      description: "Test",
      channelId: testChannelId("1000000000"),
      visibility: "OPEN",
      criteriaType: "MOST_WINS",
      criteriaConfig: "{}",
      creatorDiscordId: testAccountId("1000000000000"),
      createdTime: now,
      updatedTime: now,
    },
  });
}

/**
 * Create test player with subscription
 */
async function createPlayerWithSubscription(prisma: PrismaClient, alias: string, now: Date) {
  return prisma.player.create({
    data: {
      alias,
      serverId: testGuildId("1000000001"),
      creatorDiscordId: testAccountId("1000000000000"),
      createdTime: now,
      updatedTime: now,
      subscriptions: {
        create: {
          channelId: testChannelId("1000000000"),
          serverId: testGuildId("1000000001"),
          creatorDiscordId: testAccountId("1000000000000"),
          createdTime: now,
          updatedTime: now,
        },
      },
    },
  });
}

/**
 * Create test player with competition participation
 */
async function createPlayerWithCompetition(options: {
  prisma: PrismaClient;
  alias: string;
  competitionId: CompetitionId;
  status: "JOINED" | "LEFT" | "INVITED";
  now: Date;
}) {
  const { prisma, alias, competitionId, status, now } = options;
  return prisma.player.create({
    data: {
      alias,
      serverId: testGuildId("1000000001"),
      creatorDiscordId: testAccountId("1000000000000"),
      createdTime: now,
      updatedTime: now,
      competitionParticipants: {
        create: {
          competitionId,
          status,
          ...(status === "JOINED" ? { joinedAt: now } : {}),
          ...(status === "LEFT" ? { leftAt: now } : {}),
          ...(status === "INVITED" ? { invitedBy: testAccountId("2000000000000"), invitedAt: now } : {}),
        },
      },
    },
  });
}

/**
 * Setup test database
 */
function setupTestDatabase(): { prisma: PrismaClient; testDir: string; testDbPath: string } {
  // Use the test database utility
  const { prisma, dbPath: testDbPath } = createTestDatabase(
    `prune-players-test-${Date.now().toString()}-${Math.random().toString(36).slice(2)}`,
  );
  const testDir = testDbPath.replace("/test.db", "");

  return { prisma, testDir, testDbPath };
}

describe.serial("pruneOrphanedPlayers", () => {
  let prisma: PrismaClient;
  let testDir: string;

  beforeEach(async () => {
    const setup = setupTestDatabase();
    prisma = setup.prisma;
    testDir = setup.testDir;
  });

  afterEach(async () => {
    // Clean up
    await prisma.$disconnect();
    await Bun.spawn(["rm", "-rf", testDir]).exited;
  });

  it("should prune players with no subscriptions and no active competitions", async () => {
    const now = new Date();

    // Create an orphaned player
    await prisma.player.create({
      data: {
        alias: "orphaned",
        serverId: testGuildId("1000000001"),
        creatorDiscordId: testAccountId("1000000000000"),
        createdTime: now,
        updatedTime: now,
      },
    });

    // Verify player exists
    const beforeCount = await prisma.player.count();
    expect(beforeCount).toBe(1);

    // Prune orphaned players (disable notifications in tests)
    const result = await pruneOrphanedPlayers(prisma, false, null);

    // Verify player was pruned
    expect(result.totalPlayersPruned).toBe(1);
    const afterCount = await prisma.player.count();
    expect(afterCount).toBe(0);
  });

  it("should NOT prune players with subscriptions", async () => {
    const now = new Date();

    // Create a player with a subscription
    await createPlayerWithSubscription(prisma, "subscribed", now);

    // Verify player exists
    const beforeCount = await prisma.player.count();
    expect(beforeCount).toBe(1);

    // Prune orphaned players (disable notifications in tests)
    const result = await pruneOrphanedPlayers(prisma, false, null);

    // Verify player was NOT pruned
    expect(result.totalPlayersPruned).toBe(0);
    const afterCount = await prisma.player.count();
    expect(afterCount).toBe(1);
  });

  it("should NOT prune players with active competition participations", async () => {
    const now = new Date();

    // Create a competition
    const competition = await createTestCompetition(prisma, now);

    // Create a player with active competition participation
    await createPlayerWithCompetition({
      prisma,
      alias: "competing",
      competitionId: CompetitionIdSchema.parse(competition.id),
      status: "JOINED",
      now,
    });

    // Verify player exists
    const beforeCount = await prisma.player.count();
    expect(beforeCount).toBe(1);

    // Prune orphaned players (disable notifications in tests)
    const result = await pruneOrphanedPlayers(prisma, false, null);

    // Verify player was NOT pruned
    expect(result.totalPlayersPruned).toBe(0);
    const afterCount = await prisma.player.count();
    expect(afterCount).toBe(1);
  });

  it("should prune players with LEFT or INVITED competition status", async () => {
    const now = new Date();

    // Create a competition
    const competition = await createTestCompetition(prisma, now);

    // Create a player who left the competition
    await createPlayerWithCompetition({
      prisma,
      alias: "left",
      competitionId: CompetitionIdSchema.parse(competition.id),
      status: "LEFT",
      now,
    });

    // Create a player who was only invited
    await createPlayerWithCompetition({
      prisma,
      alias: "invited",
      competitionId: CompetitionIdSchema.parse(competition.id),
      status: "INVITED",
      now,
    });

    // Verify players exist
    const beforeCount = await prisma.player.count();
    expect(beforeCount).toBe(2);

    // Prune orphaned players (disable notifications in tests)
    const result = await pruneOrphanedPlayers(prisma, false, null);

    // Verify both players were pruned
    expect(result.totalPlayersPruned).toBe(2);
    const afterCount = await prisma.player.count();
    expect(afterCount).toBe(0);
  });

  it("should delete associated accounts when pruning players", async () => {
    const now = new Date();

    // Create a player with accounts
    await prisma.player.create({
      data: {
        alias: "orphaned",
        serverId: testGuildId("1000000001"),
        creatorDiscordId: testAccountId("1000000000000"),
        createdTime: now,
        updatedTime: now,
        accounts: {
          create: [
            {
              alias: "account1",
              puuid: testPuuid("1"),
              region: "AMERICA_NORTH",
              serverId: testGuildId("1000000001"),
              creatorDiscordId: testAccountId("1000000000000"),
              createdTime: now,
              updatedTime: now,
            },
            {
              alias: "account2",
              puuid: testPuuid("2"),
              region: "EU_WEST",
              serverId: testGuildId("1000000001"),
              creatorDiscordId: testAccountId("1000000000000"),
              createdTime: now,
              updatedTime: now,
            },
          ],
        },
      },
    });

    // Verify accounts exist
    const beforeAccountCount = await prisma.account.count();
    expect(beforeAccountCount).toBe(2);

    // Prune orphaned players (disable notifications in tests)
    const result = await pruneOrphanedPlayers(prisma, false, null);

    // Verify accounts were deleted
    expect(result.totalPlayersPruned).toBe(1);
    expect(result.totalAccountsDeleted).toBe(2);
    const afterAccountCount = await prisma.account.count();
    expect(afterAccountCount).toBe(0);
  });

  it("should handle mixed scenarios correctly", async () => {
    const now = new Date();

    // Create a competition
    const competition = await createTestCompetition(prisma, now);

    // Create orphaned player (should be pruned)
    await prisma.player.create({
      data: {
        alias: "orphaned",
        serverId: testGuildId("1000000001"),
        creatorDiscordId: testAccountId("1000000000000"),
        createdTime: now,
        updatedTime: now,
      },
    });

    // Create subscribed player (should NOT be pruned)
    await prisma.player.create({
      data: {
        alias: "subscribed",
        serverId: testGuildId("1000000001"),
        creatorDiscordId: testAccountId("1000000000000"),
        createdTime: now,
        updatedTime: now,
        subscriptions: {
          create: {
            channelId: testChannelId("1000000000"),
            serverId: testGuildId("1000000001"),
            creatorDiscordId: testAccountId("1000000000000"),
            createdTime: now,
            updatedTime: now,
          },
        },
      },
    });

    // Create competing player (should NOT be pruned)
    await prisma.player.create({
      data: {
        alias: "competing",
        serverId: testGuildId("1000000001"),
        creatorDiscordId: testAccountId("1000000000000"),
        createdTime: now,
        updatedTime: now,
        competitionParticipants: {
          create: {
            competitionId: CompetitionIdSchema.parse(competition.id),
            status: "JOINED",
            joinedAt: now,
          },
        },
      },
    });

    // Create player who left competition (should be pruned)
    await prisma.player.create({
      data: {
        alias: "left",
        serverId: testGuildId("1000000001"),
        creatorDiscordId: testAccountId("1000000000000"),
        createdTime: now,
        updatedTime: now,
        competitionParticipants: {
          create: {
            competitionId: CompetitionIdSchema.parse(competition.id),
            status: "LEFT",
            leftAt: now,
          },
        },
      },
    });

    // Verify all players exist
    const beforeCount = await prisma.player.count();
    expect(beforeCount).toBe(4);

    // Prune orphaned players (disable notifications in tests)
    const result = await pruneOrphanedPlayers(prisma, false, null);

    // Verify only orphaned and left players were pruned
    expect(result.totalPlayersPruned).toBe(2);
    expect(result.serverSummaries.length).toBe(1);
    expect(result.serverSummaries[0]?.playersPruned).toBe(2);

    const afterCount = await prisma.player.count();
    expect(afterCount).toBe(2);

    // Verify the correct players remain
    const remainingPlayers = await prisma.player.findMany();
    const remainingAliases = remainingPlayers.map((p) => p.alias).sort();
    expect(remainingAliases).toEqual(["competing", "subscribed"]);
  });
});
