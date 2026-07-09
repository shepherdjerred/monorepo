import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { DiscordAPIError } from "discord.js";
import { reconcileRemovedGuilds } from "#src/league/tasks/cleanup/reconcile-removed-guilds.ts";
import { mockClient, mockGuild } from "#src/testing/discord-mocks.ts";
import {
  testGuildId,
  testAccountId,
  testChannelId,
} from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

const { prisma } = createTestDatabase("reconcile-removed-guilds-test");

const memberGuild = testGuildId("610000000000000001");
const removedGuild = testGuildId("620000000000000002");

async function seedGuild(
  db: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<void> {
  const now = new Date();
  await db.player.create({
    data: {
      alias: `player-${serverId}`,
      discordId: testAccountId("800"),
      serverId,
      creatorDiscordId: testAccountId("801"),
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.guildPermissionError.create({
    data: {
      serverId,
      channelId: testChannelId("100"),
      errorType: "api_error",
      firstOccurrence: now,
      lastOccurrence: now,
      consecutiveErrorCount: 3,
    },
  });
}

function unknownGuildError(): DiscordAPIError {
  return new DiscordAPIError(
    { code: 10_004, message: "Unknown Guild" },
    10_004,
    404,
    "GET",
    "https://discord.com/api/v10/guilds/000",
    { files: [], body: {} },
  );
}

function clientWithMembers(
  memberIds: string[],
  options: {
    ready?: boolean;
    // Guilds the API confirms membership for even though they're missing
    // from the cache (simulates a stale-cache false positive).
    verifiableIds?: string[];
  } = {},
) {
  const { ready = true, verifiableIds = [] } = options;
  return mockClient({
    isReady: () => ready,
    guilds: {
      cache: new Map(memberIds.map((id) => [id, { id }])),
      fetch: (serverId: string) =>
        verifiableIds.includes(serverId)
          ? Promise.resolve(mockGuild({ id: serverId }))
          : Promise.reject(unknownGuildError()),
    },
  });
}

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.guildPermissionError.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reconcileRemovedGuilds", () => {
  test("cleans up guilds the bot is no longer a member of, keeps current ones", async () => {
    await seedGuild(prisma, memberGuild);
    await seedGuild(prisma, removedGuild);

    // Bot is only in memberGuild now.
    await reconcileRemovedGuilds(clientWithMembers([memberGuild]), prisma);

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(0);
    expect(
      await prisma.guildPermissionError.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(0);

    expect(
      await prisma.player.count({ where: { serverId: memberGuild } }),
    ).toBe(1);
  });

  test("is a no-op when the client is not ready (avoids wiping during startup)", async () => {
    await seedGuild(prisma, removedGuild);

    await reconcileRemovedGuilds(
      clientWithMembers([], { ready: false }),
      prisma,
    );

    // Nothing removed — we couldn't trust the (empty) membership snapshot.
    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
  });

  test("is a no-op when the guild cache is empty", async () => {
    await seedGuild(prisma, removedGuild);

    await reconcileRemovedGuilds(clientWithMembers([]), prisma);

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
  });

  test("keeps data for a guild missing from cache but confirmed still a member via fetch (stale cache)", async () => {
    await seedGuild(prisma, removedGuild);

    // removedGuild isn't in the cache, but a live fetch confirms it's still
    // a real member — this is the exact scenario that caused the 2026-07
    // ScoutScheduledReportMissedWeekly incident.
    const client = clientWithMembers([memberGuild], {
      verifiableIds: [removedGuild],
    });
    await reconcileRemovedGuilds(client, prisma);

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
  });

  test("keeps data when fetch fails for a reason other than Unknown Guild (fail safe)", async () => {
    await seedGuild(prisma, removedGuild);

    const client = mockClient({
      isReady: () => true,
      guilds: {
        cache: new Map([[memberGuild, { id: memberGuild }]]),
        fetch: () =>
          Promise.reject(
            new DiscordAPIError(
              { code: 0, message: "Internal Server Error" },
              0,
              500,
              "GET",
              "https://discord.com/api/v10/guilds/000",
              { files: [], body: {} },
            ),
          ),
      },
    });
    await reconcileRemovedGuilds(client, prisma);

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
  });
});
