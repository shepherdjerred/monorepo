import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { addSubscriptionChannel } from "#src/lib/subscription/add-channel.ts";
import { moveSubscription } from "#src/lib/subscription/move.ts";
import type { DiscordChannelId, PlayerId } from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("subscription-channel-ops");
const guildId = testGuildId("8801");
const actorDiscordId = testAccountId("8802");

beforeEach(async () => {
  await deleteIfExists(() => prisma.subscription.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("addSubscriptionChannel", () => {
  test("adds a second channel and returns all channel ids", async () => {
    const player = await createPlayer("ChannelAdd");
    const existingChannelId = testChannelId("101");
    const newChannelId = testChannelId("102");
    await createSubscription(player.id, existingChannelId);

    const result = await addSubscriptionChannel(
      {
        guildId,
        alias: player.alias,
        channelId: newChannelId,
        actorDiscordId,
      },
      prisma,
    );

    expect(result).toEqual({
      kind: "added",
      allChannelIds: [existingChannelId, newChannelId],
    });
    const subscriptions = await prisma.subscription.findMany({
      where: { playerId: player.id },
      orderBy: { channelId: "asc" },
      select: { channelId: true },
    });
    expect(subscriptions).toEqual([
      { channelId: existingChannelId },
      { channelId: newChannelId },
    ]);
  });

  test("reports duplicate and missing player states", async () => {
    const player = await createPlayer("ChannelDuplicate");
    const channelId = testChannelId("103");
    await createSubscription(player.id, channelId);

    await expect(
      addSubscriptionChannel(
        { guildId, alias: player.alias, channelId, actorDiscordId },
        prisma,
      ),
    ).resolves.toEqual({ kind: "already-subscribed", channelId });
    await expect(
      addSubscriptionChannel(
        { guildId, alias: "Missing", channelId, actorDiscordId },
        prisma,
      ),
    ).resolves.toEqual({ kind: "player-not-found" });
  });
});

describe("moveSubscription", () => {
  test("moves a subscription between channels", async () => {
    const player = await createPlayer("MovePlayer");
    const fromChannelId = testChannelId("201");
    const toChannelId = testChannelId("202");
    await createSubscription(player.id, fromChannelId);

    await expect(
      moveSubscription(
        {
          guildId,
          alias: player.alias,
          fromChannelId,
          toChannelId,
          actorDiscordId,
        },
        prisma,
      ),
    ).resolves.toEqual({ kind: "moved" });
    const subscriptions = await prisma.subscription.findMany({
      where: { playerId: player.id },
      select: { channelId: true },
    });
    expect(subscriptions).toEqual([{ channelId: toChannelId }]);
  });

  test("reports missing source and duplicate destination states", async () => {
    const player = await createPlayer("MoveFailures");
    const fromChannelId = testChannelId("203");
    const toChannelId = testChannelId("204");
    await createSubscription(player.id, toChannelId);

    await expect(
      moveSubscription(
        {
          guildId,
          alias: player.alias,
          fromChannelId,
          toChannelId,
          actorDiscordId,
        },
        prisma,
      ),
    ).resolves.toEqual({ kind: "not-subscribed-in-from-channel" });

    await createSubscription(player.id, fromChannelId);
    await expect(
      moveSubscription(
        {
          guildId,
          alias: player.alias,
          fromChannelId,
          toChannelId,
          actorDiscordId,
        },
        prisma,
      ),
    ).resolves.toEqual({ kind: "already-subscribed-in-to-channel" });
  });
});

async function createPlayer(alias: string) {
  const now = new Date();
  return prisma.player.create({
    data: {
      alias,
      discordId: null,
      serverId: guildId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function createSubscription(
  playerId: PlayerId,
  channelId: DiscordChannelId,
) {
  const now = new Date();
  return prisma.subscription.create({
    data: {
      playerId,
      channelId,
      serverId: guildId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}
