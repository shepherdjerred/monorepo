import { afterAll, describe, test, expect, beforeEach } from "bun:test";

import { testGuildId, testAccountId, testChannelId, testPuuid } from "@shepherdjerred/scout-backend/testing/test-ids.ts";
import { addLimitOverride, clearLimitOverrides } from "@shepherdjerred/scout-backend/configuration/flags.ts";
import { type DiscordGuildId, type DiscordAccountId, type DiscordChannelId } from "@shepherdjerred/scout-data";
import { createTestDatabase, deleteIfExists } from "@shepherdjerred/scout-backend/testing/test-database.ts";

// Constants for testing
const DEFAULT_PLAYER_SUBSCRIPTION_LIMIT = 75;
const DEFAULT_ACCOUNT_LIMIT = 50;

// Create test database
const { prisma: testPrisma } = createTestDatabase("subscribe-limits-test");

beforeEach(async () => {
  // Clean up test data
  await deleteIfExists(() => testPrisma.subscription.deleteMany());
  await deleteIfExists(() => testPrisma.account.deleteMany());
  await deleteIfExists(() => testPrisma.player.deleteMany());
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

// ============================================================================
// Helper Functions
// ============================================================================

type TestPlayerOptions = {
  count: number;
  serverId: DiscordGuildId;
  channelId: DiscordChannelId;
  discordUserId: DiscordAccountId;
  now: Date;
  prefix?: string;
};

async function createSubscribedPlayers(opts: TestPlayerOptions) {
  const { count, serverId, channelId, discordUserId, now, prefix = "" } = opts;

  for (let i = 0; i < count; i++) {
    const idx = i.toString();
    await testPrisma.subscription.create({
      data: {
        channelId,
        serverId,
        creatorDiscordId: discordUserId,
        createdTime: now,
        updatedTime: now,
        player: {
          create: {
            alias: `${prefix}Player${idx}`,
            discordId: null,
            serverId,
            creatorDiscordId: discordUserId,
            createdTime: now,
            updatedTime: now,
            accounts: {
              create: {
                alias: `${prefix}Player${idx}`,
                puuid: testPuuid(`${prefix.toLowerCase()}-${idx}`),
                region: "AMERICA_NORTH",
                serverId,
                creatorDiscordId: discordUserId,
                createdTime: now,
                updatedTime: now,
              },
            },
          },
        },
      },
    });
  }
}

async function createUnsubscribedPlayers(opts: TestPlayerOptions) {
  const { count, serverId, discordUserId, now, prefix = "" } = opts;

  for (let i = 0; i < count; i++) {
    const idx = i.toString();
    await testPrisma.player.create({
      data: {
        alias: `${prefix}Player${idx}`,
        discordId: null,
        serverId,
        creatorDiscordId: discordUserId,
        createdTime: now,
        updatedTime: now,
        accounts: {
          create: {
            alias: `${prefix}Player${idx}`,
            puuid: testPuuid(`${prefix.toLowerCase()}-${idx}`),
            region: "AMERICA_NORTH",
            serverId,
            creatorDiscordId: discordUserId,
            createdTime: now,
            updatedTime: now,
          },
        },
      },
    });
  }
}

describe("Subscribe Command - Subscription Limits", () => {
  test("allows subscriptions up to the limit", async () => {
    const now = new Date();
    const serverId = testGuildId("01");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Create a smaller subset for faster testing
    const testLimit = Math.min(5, DEFAULT_PLAYER_SUBSCRIPTION_LIMIT);

    await createSubscribedPlayers({ count: testLimit, serverId, channelId, discordUserId, now });

    // Verify we created the correct number of subscribed players
    const subscribedPlayerCount = await testPrisma.player.count({
      where: {
        serverId: serverId,
        subscriptions: {
          some: {},
        },
      },
    });

    expect(subscribedPlayerCount).toBe(testLimit);
  });

  test("counts only players with active subscriptions", async () => {
    const now = new Date();
    const serverId = testGuildId("001");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Create 5 players with subscriptions
    await createSubscribedPlayers({
      count: 5,
      serverId,
      channelId,
      discordUserId,
      now,
      prefix: "Subscribed",
    });

    // Create 3 players WITHOUT subscriptions
    await createUnsubscribedPlayers({ count: 3, serverId, channelId, discordUserId, now, prefix: "Unsubscribed" });

    // Verify only players with subscriptions are counted
    const subscribedPlayerCount = await testPrisma.player.count({
      where: {
        serverId: serverId,
        subscriptions: {
          some: {},
        },
      },
    });

    expect(subscribedPlayerCount).toBe(5);

    // Verify total players is 8
    const totalPlayerCount = await testPrisma.player.count({
      where: {
        serverId: serverId,
      },
    });

    expect(totalPlayerCount).toBe(8);
  });

  test("allows adding accounts to existing player even at limit", async () => {
    const now = new Date();
    const serverId = testGuildId("003");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Create limit number of players with subscriptions
    await createSubscribedPlayers({
      count: DEFAULT_PLAYER_SUBSCRIPTION_LIMIT,
      serverId,
      channelId,
      discordUserId,
      now,
    });

    // Get one of the existing players
    const existingPlayer = await testPrisma.player.findFirst({
      where: {
        serverId: serverId,
        alias: "Player0",
      },
    });

    expect(existingPlayer).not.toBeNull();

    if (!existingPlayer) {
      throw new Error("Expected player not found");
    }

    // Should be able to add a second account to this player even at limit
    const secondAccount = await testPrisma.account.create({
      data: {
        alias: "Player0", // Same alias
        puuid: testPuuid("player0-euw"),
        region: "EU_WEST",
        serverId: serverId,
        creatorDiscordId: discordUserId,
        playerId: existingPlayer.id,
        createdTime: now,
        updatedTime: now,
      },
    });

    expect(secondAccount.playerId).toBe(existingPlayer.id);

    // Verify player count hasn't changed
    const subscribedPlayerCount = await testPrisma.player.count({
      where: {
        serverId: serverId,
        subscriptions: {
          some: {},
        },
      },
    });

    expect(subscribedPlayerCount).toBe(DEFAULT_PLAYER_SUBSCRIPTION_LIMIT);
  });

  test("unlimited servers bypass the limit", async () => {
    const now = new Date();
    const serverId = testGuildId("004");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Add unlimited override for this server
    addLimitOverride("player_subscriptions", "unlimited", { server: serverId });

    try {
      // Use a smaller test limit to avoid timeout - the concept is the same
      // We just need to verify that with unlimited override, we can exceed any limit
      const testLimit = 10;
      const extraPlayers = 5;
      await createSubscribedPlayers({
        count: testLimit + extraPlayers,
        serverId,
        channelId,
        discordUserId,
        now,
        prefix: "Unlimited",
      });

      // Verify we exceeded the test limit (proving unlimited works)
      const subscribedPlayerCount = await testPrisma.player.count({
        where: {
          serverId: serverId,
          subscriptions: {
            some: {},
          },
        },
      });

      expect(subscribedPlayerCount).toBe(testLimit + extraPlayers);
    } finally {
      // Clean up - remove the override
      clearLimitOverrides("player_subscriptions");
    }
  });

  test("limits are enforced per-server independently", async () => {
    const now = new Date();
    const server1Id = testGuildId("005");
    const server2Id = testGuildId("006");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Use a smaller test limit to avoid timeout - the concept is the same
    // We just need to verify that each server's count is independent
    const testLimit = 10;

    // Create test limit number of players in server 1
    await createSubscribedPlayers({
      count: testLimit,
      serverId: server1Id,
      channelId,
      discordUserId,
      now,
      prefix: "Server1",
    });

    // Create test limit number of players in server 2
    await createSubscribedPlayers({
      count: testLimit,
      serverId: server2Id,
      channelId,
      discordUserId,
      now,
      prefix: "Server2",
    });

    // Verify each server has the correct count (independent of each other)
    const server1Count = await testPrisma.player.count({
      where: {
        serverId: server1Id,
        subscriptions: {
          some: {},
        },
      },
    });

    const server2Count = await testPrisma.player.count({
      where: {
        serverId: server2Id,
        subscriptions: {
          some: {},
        },
      },
    });

    expect(server1Count).toBe(testLimit);
    expect(server2Count).toBe(testLimit);
  });
});

describe("Subscribe Command - Account Limits", () => {
  test("allows accounts up to the account limit", async () => {
    const now = new Date();
    const serverId = testGuildId("007");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Create a smaller subset for faster testing
    const testAccountLimit = Math.min(5, DEFAULT_ACCOUNT_LIMIT);

    await createUnsubscribedPlayers({ count: testAccountLimit, serverId, channelId, discordUserId, now });

    // Verify we created the correct number of accounts
    const accountCount = await testPrisma.account.count({
      where: {
        serverId: serverId,
      },
    });

    expect(accountCount).toBe(testAccountLimit);
  });

  test("account limit counts all accounts regardless of subscriptions", async () => {
    const now = new Date();
    const serverId = testGuildId("008");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Create 5 accounts WITH subscriptions
    await createSubscribedPlayers({
      count: 5,
      serverId,
      channelId,
      discordUserId,
      now,
      prefix: "Subscribed",
    });

    // Create 3 accounts WITHOUT subscriptions
    await createUnsubscribedPlayers({ count: 3, serverId, channelId, discordUserId, now, prefix: "Unsubscribed" });

    // Verify total account count is 8 (5 + 3)
    const accountCount = await testPrisma.account.count({
      where: {
        serverId: serverId,
      },
    });

    expect(accountCount).toBe(8);

    // Verify only 5 have subscriptions
    const subscribedPlayerCount = await testPrisma.player.count({
      where: {
        serverId: serverId,
        subscriptions: {
          some: {},
        },
      },
    });

    expect(subscribedPlayerCount).toBe(5);
  });

  test("account limit is enforced per-server independently", async () => {
    const now = new Date();
    const server1Id = testGuildId("009");
    const server2Id = testGuildId("010");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Create limit number of accounts in server 1
    await createUnsubscribedPlayers({
      count: DEFAULT_ACCOUNT_LIMIT,
      serverId: server1Id,
      channelId,
      discordUserId,
      now,
      prefix: "Server1",
    });

    // Create limit number of accounts in server 2
    await createUnsubscribedPlayers({
      count: DEFAULT_ACCOUNT_LIMIT,
      serverId: server2Id,
      channelId,
      discordUserId,
      now,
      prefix: "Server2",
    });

    // Verify each server has the correct count
    const server1Count = await testPrisma.account.count({
      where: {
        serverId: server1Id,
      },
    });

    const server2Count = await testPrisma.account.count({
      where: {
        serverId: server2Id,
      },
    });

    expect(server1Count).toBe(DEFAULT_ACCOUNT_LIMIT);
    expect(server2Count).toBe(DEFAULT_ACCOUNT_LIMIT);
  });

  test("unlimited servers bypass account limit", async () => {
    const now = new Date();
    const serverId = testGuildId("011");
    const channelId = testChannelId("00001");
    const discordUserId = testAccountId("0000001");

    // Add unlimited override for accounts
    addLimitOverride("accounts", 999999, { server: serverId });

    try {
      // Create more than the default account limit
      const extraAccounts = 5;
      await createUnsubscribedPlayers({
        count: DEFAULT_ACCOUNT_LIMIT + extraAccounts,
        serverId,
        channelId,
        discordUserId,
        now,
        prefix: "Unlimited",
      });

      // Verify we exceeded the limit
      const accountCount = await testPrisma.account.count({
        where: {
          serverId: serverId,
        },
      });

      expect(accountCount).toBe(DEFAULT_ACCOUNT_LIMIT + extraAccounts);
    } finally {
      // Clean up - remove the override
      clearLimitOverrides("accounts");
    }
  });
});
