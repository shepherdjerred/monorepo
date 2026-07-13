import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

// Offline tRPC harness: real router + audit writes, no Discord OAuth, no real
// Discord backing. See src/testing/test-trpc-caller.ts.
const trpc = await createOfflineTrpcHarness("trpc-mute-test");
const { prisma: testPrisma } = trpc;

const guildId = DiscordGuildIdSchema.parse("100000000000000002");
const channelId = DiscordChannelIdSchema.parse("200000000000000002");
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000002");

async function seedSubscription(alias: string) {
  const now = new Date();
  const player = await testPrisma.player.create({
    data: {
      alias,
      serverId: guildId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
  await testPrisma.subscription.create({
    data: {
      playerId: player.id,
      channelId,
      serverId: guildId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
  return player;
}

beforeEach(async () => {
  await testPrisma.auditLog.deleteMany();
  await testPrisma.subscription.deleteMany();
  await testPrisma.player.deleteMany();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("subscription.setMuted (tRPC web mutation, no login)", () => {
  test("mutes the row and writes an audit entry", async () => {
    const player = await seedSubscription("Solo");

    const result = await trpc.authedCaller().subscription.setMuted({
      guildId,
      channelId,
      alias: "Solo",
      isMuted: true,
    });
    expect(result.kind).toBe("updated");

    const row = await testPrisma.subscription.findFirst({
      where: { playerId: player.id, channelId },
    });
    expect(row?.isMuted).toBe(true);

    const audit = await testPrisma.auditLog.findFirst({
      where: { serverId: guildId, action: "SUBSCRIPTION_SET_MUTED" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit?.payload ?? "{}")).toEqual({
      alias: "Solo",
      isMuted: true,
    });
  });

  test("unmutes a muted subscription", async () => {
    const player = await seedSubscription("Solo");
    await testPrisma.subscription.updateMany({
      where: { playerId: player.id },
      data: { isMuted: true },
    });

    const result = await trpc.authedCaller().subscription.setMuted({
      guildId,
      channelId,
      alias: "Solo",
      isMuted: false,
    });
    expect(result.kind).toBe("updated");

    const row = await testPrisma.subscription.findFirst({
      where: { playerId: player.id, channelId },
    });
    expect(row?.isMuted).toBe(false);
  });

  test("reports player-not-found without an audit entry", async () => {
    const result = await trpc.authedCaller().subscription.setMuted({
      guildId,
      channelId,
      alias: "Nobody",
      isMuted: true,
    });
    expect(result.kind).toBe("player-not-found");
    const audit = await testPrisma.auditLog.findFirst({
      where: { serverId: guildId, action: "SUBSCRIPTION_SET_MUTED" },
    });
    expect(audit).toBeNull();
  });

  test("rejects anonymous callers", async () => {
    await seedSubscription("Solo");
    await expect(
      trpc.anonCaller().subscription.setMuted({
        guildId,
        channelId,
        alias: "Solo",
        isMuted: true,
      }),
    ).rejects.toThrow();
  });

  test("list surfaces isMuted", async () => {
    const player = await seedSubscription("Solo");
    await testPrisma.subscription.updateMany({
      where: { playerId: player.id },
      data: { isMuted: true },
    });

    const { items } = await trpc
      .authedCaller()
      .subscription.list({ guildId, limit: 50 });
    expect(items).toHaveLength(1);
    expect(items[0]?.isMuted).toBe(true);
  });
});
