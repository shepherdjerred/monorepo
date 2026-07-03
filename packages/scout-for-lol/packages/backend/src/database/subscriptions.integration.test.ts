import {
  afterAll,
  test,
  expect,
  beforeEach,
  afterEach,
  describe,
} from "bun:test";
import { getChannelsSubscribedToPlayers } from "#src/database/index.ts";
import {
  setSubscriptionFilters,
  setChannelFilters,
} from "#src/lib/subscription/filters.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  filtersPass,
  serializeSubscriptionFilters,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type LeaguePuuid,
  type PlayerId,
  type SerializedSubscriptionFilters,
} from "@scout-for-lol/data";

import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";

// Create a temporary database for testing
const { prisma: testPrisma } = createTestDatabase("subscriptions-test");

beforeEach(async () => {
  // Clean up database before each test
  await deleteIfExists(() => testPrisma.subscription.deleteMany());
  await deleteIfExists(() => testPrisma.account.deleteMany());
  await deleteIfExists(() => testPrisma.player.deleteMany());
});

afterEach(async () => {
  // Clean up after each test
  await deleteIfExists(() => testPrisma.subscription.deleteMany());
  await deleteIfExists(() => testPrisma.account.deleteMany());
  await deleteIfExists(() => testPrisma.player.deleteMany());
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

// Helper function to create a valid 78-character PUUID
function testPuuid(identifier: string): LeaguePuuid {
  // PUUIDs are exactly 78 characters long
  const base = `puuid-${identifier}`;
  return LeaguePuuidSchema.parse(base.padEnd(78, "0"));
}

// Helper function to create a valid Discord channel ID (17-20 numeric characters)
function testChannelId(identifier: string): DiscordChannelId {
  // Discord channel IDs are 17-20 characters and must be numeric (snowflake IDs)
  // Format: Take a base number and pad it to make it 18 characters
  const base = identifier.replaceAll(/\D/g, ""); // Remove non-digits
  const numericId = `1${base}`.padEnd(18, "0");
  return DiscordChannelIdSchema.parse(numericId);
}

// Helper function to create a valid Discord account ID (17-18 numeric characters)
function testAccountId(identifier: string): DiscordAccountId {
  const base = identifier.replaceAll(/\D/g, ""); // Remove non-digits
  const numericId = `2${base}`.padEnd(18, "0");
  return DiscordAccountIdSchema.parse(numericId);
}

// Helper function to create a valid Discord guild ID (17-20 numeric characters)
function testGuildId(identifier: string): DiscordGuildId {
  const base = identifier.replaceAll(/\D/g, ""); // Remove non-digits
  const numericId = `3${base}`.padEnd(18, "0");
  return DiscordGuildIdSchema.parse(numericId);
}

// Helper function to create test data with required metadata
async function createTestPlayer(alias: string, serverId: DiscordGuildId) {
  const now = new Date();
  return await testPrisma.player.create({
    data: {
      alias,
      discordId: testAccountId(alias),
      serverId,
      creatorDiscordId: testAccountId("testcreator"),
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function createTestAccount(
  puuid: LeaguePuuid,
  playerId: PlayerId,
  serverId: DiscordGuildId,
  alias: string,
) {
  const now = new Date();
  return await testPrisma.account.create({
    data: {
      puuid,
      region: "AMERICA_NORTH",
      alias,
      playerId,
      serverId,
      creatorDiscordId: testAccountId("testcreator"),
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function createTestSubscription(
  playerId: PlayerId,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
  filters?: SerializedSubscriptionFilters | null,
) {
  return await testPrisma.subscription.create({
    data: {
      playerId,
      channelId,
      serverId,
      creatorDiscordId: testAccountId("testcreator"),
      createdTime: new Date(),
      updatedTime: new Date(),
      filters: filters ?? null,
    },
  });
}

describe("getChannelsSubscribedToPlayers - Deduplication Fix", () => {
  test("deduplicates channels when a player is tracked in multiple servers to the same channel", async () => {
    // This is the core bug fix: When Server A and Server B both track Player X
    // and both subscribe to channel #123, we should only send ONE message to #123

    const player = await createTestPlayer(
      "TestPlayer",
      testGuildId("1000000001"),
    );

    // Create account for the player
    const account = await createTestAccount(
      testPuuid("main"),
      player.id,
      testGuildId("1000000001"),
      player.alias,
    );

    // Create two subscriptions in different servers but to the SAME channel
    const channelId = testChannelId("123");
    await createTestSubscription(
      player.id,
      channelId,
      testGuildId("1000000001"),
    );
    await createTestSubscription(
      player.id,
      channelId,
      testGuildId("2000000002"),
    );

    // Get channels subscribed to this player
    const puuid = LeaguePuuidSchema.parse(account.puuid);
    const channels = await getChannelsSubscribedToPlayers([puuid], testPrisma);

    // Should only return 1 channel, not 2 (deduplication working!)
    expect(channels).toHaveLength(1);
    expect(channels[0]?.channel).toBe(DiscordChannelIdSchema.parse(channelId));
  });

  test("returns multiple channels when player is subscribed to different channels", async () => {
    const player = await createTestPlayer(
      "TestPlayer",
      testGuildId("1000000001"),
    );
    const account = await createTestAccount(
      testPuuid("main"),
      player.id,
      testGuildId("1000000001"),
      player.alias,
    );

    // Create subscriptions to different channels
    const channel1 = testChannelId("123");
    const channel2 = testChannelId("456");
    const channel3 = testChannelId("789");
    await createTestSubscription(
      player.id,
      channel1,
      testGuildId("1000000001"),
    );
    await createTestSubscription(
      player.id,
      channel2,
      testGuildId("2000000002"),
    );
    await createTestSubscription(
      player.id,
      channel3,
      testGuildId("3000000000"),
    );

    const puuid = LeaguePuuidSchema.parse(account.puuid);
    const channels = await getChannelsSubscribedToPlayers([puuid], testPrisma);

    // Should return 3 unique channels
    expect(channels).toHaveLength(3);
    const channelIds = channels.map((c) => c.channel).toSorted();
    expect(channelIds).toEqual([
      DiscordChannelIdSchema.parse(channel1),
      DiscordChannelIdSchema.parse(channel2),
      DiscordChannelIdSchema.parse(channel3),
    ]);
  });

  test("deduplicates when multiple accounts of same player are subscribed to same channel", async () => {
    // Test case: Player has a main account and a smurf account
    // Both accounts are tracked in the same channel
    // Should only send ONE message to that channel

    const player = await createTestPlayer(
      "TestPlayer",
      testGuildId("1000000001"),
    );

    // Create two accounts for the same player (e.g., main and smurf)
    const mainAccount = await createTestAccount(
      testPuuid("main"),
      player.id,
      testGuildId("1000000001"),
      player.alias,
    );
    const smurfAccount = await createTestAccount(
      testPuuid("smurf"),
      player.id,
      testGuildId("1000000001"),
      `${player.alias}-smurf`,
    );

    // Create a subscription for the player (applies to all their accounts)
    const channelId = testChannelId("123");
    await createTestSubscription(
      player.id,
      channelId,
      testGuildId("1000000001"),
    );

    // Get channels for both accounts
    const puuids = [mainAccount.puuid, smurfAccount.puuid].map((p) =>
      LeaguePuuidSchema.parse(p),
    );
    const channels = await getChannelsSubscribedToPlayers(puuids, testPrisma);

    // Should only return 1 channel, not 2 (deduplication working!)
    expect(channels).toHaveLength(1);
    expect(channels[0]?.channel).toBe(DiscordChannelIdSchema.parse(channelId));
  });
});

describe("getChannelsSubscribedToPlayers - Edge Cases", () => {
  test("returns empty array when player has no subscriptions", async () => {
    const player = await createTestPlayer(
      "TestPlayer",
      testGuildId("1000000001"),
    );
    const account = await createTestAccount(
      testPuuid("main"),
      player.id,
      testGuildId("1000000001"),
      player.alias,
    );

    const puuid = LeaguePuuidSchema.parse(account.puuid);
    const channels = await getChannelsSubscribedToPlayers([puuid], testPrisma);

    expect(channels).toHaveLength(0);
  });

  test("handles complex scenario with multiple players and overlapping subscriptions", async () => {
    // Complex scenario:
    // - Player 1 subscribed to channel-A and channel-B
    // - Player 2 subscribed to channel-B and channel-C
    // - When both are in a game together, should return [channel-A, channel-B, channel-C]
    //   with channel-B deduplicated (not appearing twice)

    const player1 = await createTestPlayer(
      "Player1",
      testGuildId("1000000001"),
    );
    const player2 = await createTestPlayer(
      "Player2",
      testGuildId("1000000001"),
    );

    const account1 = await createTestAccount(
      testPuuid("player1"),
      player1.id,
      testGuildId("1000000001"),
      player1.alias,
    );
    const account2 = await createTestAccount(
      testPuuid("player2"),
      player2.id,
      testGuildId("1000000001"),
      player2.alias,
    );

    // Player 1 subscriptions
    const channelA = testChannelId("111");
    const channelB = testChannelId("222");
    const channelC = testChannelId("333");
    await createTestSubscription(
      player1.id,
      channelA,
      testGuildId("1000000001"),
    );
    await createTestSubscription(
      player1.id,
      channelB,
      testGuildId("2000000002"),
    );

    // Player 2 subscriptions (channel-B overlaps!)
    await createTestSubscription(
      player2.id,
      channelB,
      testGuildId("3000000000"),
    );
    await createTestSubscription(
      player2.id,
      channelC,
      testGuildId("4000000000"),
    );

    const puuids = [account1.puuid, account2.puuid].map((p) =>
      LeaguePuuidSchema.parse(p),
    );
    const channels = await getChannelsSubscribedToPlayers(puuids, testPrisma);

    // Should return 3 unique channels (A, B, C) not 4
    expect(channels).toHaveLength(3);
    const channelIds = channels.map((c) => c.channel).toSorted();
    expect(channelIds).toEqual([
      DiscordChannelIdSchema.parse(channelA),
      DiscordChannelIdSchema.parse(channelB),
      DiscordChannelIdSchema.parse(channelC),
    ]);
  });

  test("handles case where same player has multiple subscriptions in same server", async () => {
    // Edge case: Player is subscribed in multiple channels in the same server
    // (e.g., #general and #league-of-legends)

    const player = await createTestPlayer(
      "TestPlayer",
      testGuildId("1000000001"),
    );
    const account = await createTestAccount(
      testPuuid("main"),
      player.id,
      testGuildId("1000000001"),
      player.alias,
    );

    // Create multiple subscriptions in the same server to different channels
    const channelGeneral = testChannelId("1001");
    const channelLol = testChannelId("1002");
    await createTestSubscription(
      player.id,
      channelGeneral,
      testGuildId("1000000001"),
    );
    await createTestSubscription(
      player.id,
      channelLol,
      testGuildId("1000000001"),
    );

    const puuid = LeaguePuuidSchema.parse(account.puuid);
    const channels = await getChannelsSubscribedToPlayers([puuid], testPrisma);

    // Should return both channels
    expect(channels).toHaveLength(2);
    const channelIds = channels.map((c) => c.channel).toSorted();
    expect(channelIds).toEqual([
      DiscordChannelIdSchema.parse(channelGeneral),
      DiscordChannelIdSchema.parse(channelLol),
    ]);
  });
});

const soloOnly = serializeSubscriptionFilters({
  version: 1,
  filters: [{ type: "queue", queues: ["solo"] }],
});

describe("getChannelsSubscribedToPlayers - Filters", () => {
  test("parses a stored filter spec onto the returned subscription", async () => {
    const guildId = testGuildId("1000000001");
    const player = await createTestPlayer("Filtered", guildId);
    const account = await createTestAccount(
      testPuuid("main"),
      player.id,
      guildId,
      player.alias,
    );
    await createTestSubscription(
      player.id,
      testChannelId("123"),
      guildId,
      soloOnly,
    );

    const puuid = LeaguePuuidSchema.parse(account.puuid);
    const channels = await getChannelsSubscribedToPlayers([puuid], testPrisma);

    expect(channels).toHaveLength(1);
    expect(channels[0]?.subscriptions).toHaveLength(1);
    expect(channels[0]?.subscriptions[0]?.filters).toEqual({
      version: 1,
      filters: [{ type: "queue", queues: ["solo"] }],
    });
  });

  test("a channel with a solo-only sub and a no-filter sub delivers via `some`", async () => {
    const guildId = testGuildId("1000000001");
    const channel = testChannelId("999");

    // Player A: solo-only filter, routing to the shared channel.
    const playerA = await createTestPlayer("PlayerA", guildId);
    const accountA = await createTestAccount(
      testPuuid("a"),
      playerA.id,
      guildId,
      playerA.alias,
    );
    await createTestSubscription(playerA.id, channel, guildId, soloOnly);

    // Player B: no filter (notify all), same channel.
    const playerB = await createTestPlayer("PlayerB", guildId);
    const accountB = await createTestAccount(
      testPuuid("b"),
      playerB.id,
      guildId,
      playerB.alias,
    );
    await createTestSubscription(playerB.id, channel, guildId, null);

    const puuids = [accountA.puuid, accountB.puuid].map((p) =>
      LeaguePuuidSchema.parse(p),
    );
    const channels = await getChannelsSubscribedToPlayers(puuids, testPrisma);

    expect(channels).toHaveLength(1);
    const subs = channels[0]?.subscriptions ?? [];
    expect(subs).toHaveLength(2);

    // A solo game passes for both subs; delivered.
    expect(
      subs.some((s) => filtersPass(s.filters, { queueType: "solo" })),
    ).toBe(true);
    // An ARAM game passes only via the no-filter sub; still delivered.
    expect(
      subs.some((s) => filtersPass(s.filters, { queueType: "aram" })),
    ).toBe(true);
  });

  test("a channel with only a solo-only sub is filtered out for non-solo games", async () => {
    const guildId = testGuildId("1000000001");
    const player = await createTestPlayer("SoloOnly", guildId);
    const account = await createTestAccount(
      testPuuid("main"),
      player.id,
      guildId,
      player.alias,
    );
    await createTestSubscription(
      player.id,
      testChannelId("321"),
      guildId,
      soloOnly,
    );

    const puuid = LeaguePuuidSchema.parse(account.puuid);
    const channels = await getChannelsSubscribedToPlayers([puuid], testPrisma);
    const subs = channels[0]?.subscriptions ?? [];

    expect(
      subs.some((s) => filtersPass(s.filters, { queueType: "solo" })),
    ).toBe(true);
    expect(
      subs.some((s) => filtersPass(s.filters, { queueType: "aram" })),
    ).toBe(false);
  });
});

describe("setSubscriptionFilters / setChannelFilters", () => {
  test("setSubscriptionFilters updates a single subscription's filters", async () => {
    const guildId = testGuildId("1000000001");
    const channel = testChannelId("123");
    const player = await createTestPlayer("Solo", guildId);
    await createTestAccount(
      testPuuid("main"),
      player.id,
      guildId,
      player.alias,
    );
    await createTestSubscription(player.id, channel, guildId, null);

    const result = await setSubscriptionFilters(
      {
        guildId,
        channelId: channel,
        alias: player.alias,
        filters: { version: 1, filters: [{ type: "queue", queues: ["solo"] }] },
        actorDiscordId: testAccountId("actor"),
      },
      testPrisma,
    );
    expect(result.kind).toBe("updated");

    const row = await testPrisma.subscription.findFirst({
      where: { serverId: guildId, channelId: channel },
    });
    expect(row?.filters).toBe(soloOnly.toString());
  });

  test("setSubscriptionFilters(null) clears filters", async () => {
    const guildId = testGuildId("1000000001");
    const channel = testChannelId("123");
    const player = await createTestPlayer("Solo", guildId);
    await createTestAccount(
      testPuuid("main"),
      player.id,
      guildId,
      player.alias,
    );
    await createTestSubscription(player.id, channel, guildId, soloOnly);

    const result = await setSubscriptionFilters(
      {
        guildId,
        channelId: channel,
        alias: player.alias,
        filters: null,
        actorDiscordId: testAccountId("actor"),
      },
      testPrisma,
    );
    expect(result.kind).toBe("updated");

    const row = await testPrisma.subscription.findFirst({
      where: { serverId: guildId, channelId: channel },
    });
    expect(row?.filters).toBeNull();
  });

  test("setChannelFilters updates every sub in the channel and leaves others untouched", async () => {
    const guildId = testGuildId("1000000001");
    const targetChannel = testChannelId("111");
    const otherChannel = testChannelId("222");

    const playerA = await createTestPlayer("A", guildId);
    await createTestAccount(testPuuid("a"), playerA.id, guildId, playerA.alias);
    await createTestSubscription(playerA.id, targetChannel, guildId, null);

    const playerB = await createTestPlayer("B", guildId);
    await createTestAccount(testPuuid("b"), playerB.id, guildId, playerB.alias);
    await createTestSubscription(playerB.id, targetChannel, guildId, null);

    const playerC = await createTestPlayer("C", guildId);
    await createTestAccount(testPuuid("c"), playerC.id, guildId, playerC.alias);
    await createTestSubscription(playerC.id, otherChannel, guildId, null);

    const result = await setChannelFilters(
      {
        guildId,
        channelId: targetChannel,
        filters: { version: 1, filters: [{ type: "queue", queues: ["solo"] }] },
        actorDiscordId: testAccountId("actor"),
      },
      testPrisma,
    );
    expect(result).toEqual({ kind: "updated", count: 2 });

    const targetRows = await testPrisma.subscription.findMany({
      where: { serverId: guildId, channelId: targetChannel },
    });
    expect(targetRows.every((r) => r.filters === soloOnly.toString())).toBe(
      true,
    );

    const otherRow = await testPrisma.subscription.findFirst({
      where: { serverId: guildId, channelId: otherChannel },
    });
    expect(otherRow?.filters).toBeNull();
  });
});
