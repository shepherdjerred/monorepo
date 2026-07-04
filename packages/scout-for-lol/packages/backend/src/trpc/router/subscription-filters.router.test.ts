import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  serializeSubscriptionFilters,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

// Offline tRPC harness: real router + audit writes, no Discord OAuth, no real
// Discord backing. See src/testing/test-trpc-caller.ts.
const trpc = await createOfflineTrpcHarness("trpc-filters-test");
const { prisma: testPrisma } = trpc;

const guildId = DiscordGuildIdSchema.parse("100000000000000001");
const channelId = DiscordChannelIdSchema.parse("200000000000000001");
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000001");

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

describe("subscription.setFilters (tRPC web mutation, no login)", () => {
  test("updates the row and writes an audit entry", async () => {
    await seedSubscription("Solo");

    const result = await trpc.authedCaller().subscription.setFilters({
      guildId,
      channelId,
      alias: "Solo",
      filters: { version: 1, filters: [{ type: "queue", queues: ["solo"] }] },
    });
    expect(result.kind).toBe("updated");

    const row = await testPrisma.subscription.findFirst({
      where: { serverId: guildId, channelId },
    });
    expect(row?.filters).toBe(
      serializeSubscriptionFilters({
        version: 1,
        filters: [{ type: "queue", queues: ["solo"] }],
      }).toString(),
    );

    const audit = await testPrisma.auditLog.findFirst({
      where: { serverId: guildId, action: "SUBSCRIPTION_SET_FILTERS" },
    });
    expect(audit).not.toBeNull();
  });

  test("rejects an unauthenticated caller", async () => {
    await expect(
      trpc.anonCaller().subscription.setFilters({
        guildId,
        channelId,
        alias: "Solo",
        filters: null,
      }),
    ).rejects.toThrow();
  });
});

describe("subscription.setChannelFilters (bulk, no login)", () => {
  test("updates every subscription in the channel + audits", async () => {
    await seedSubscription("A");
    await seedSubscription("B");

    const result = await trpc.authedCaller().subscription.setChannelFilters({
      guildId,
      channelId,
      filters: { version: 1, filters: [{ type: "queue", queues: ["flex"] }] },
    });
    expect(result).toEqual({ kind: "updated", count: 2 });

    const rows = await testPrisma.subscription.findMany({
      where: { serverId: guildId, channelId },
    });
    expect(rows.every((r) => r.filters !== null)).toBe(true);

    const audit = await testPrisma.auditLog.findFirst({
      where: { serverId: guildId, action: "SUBSCRIPTION_BULK_SET_FILTERS" },
    });
    expect(audit).not.toBeNull();
  });
});
