import { describe, expect, test, afterAll, beforeEach } from "vitest";
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
  await db.bucksNotificationPreference.create({
    data: {
      serverId,
      discordId: testAccountId("802"),
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

/**
 * A client used only for the REST confirmation step.
 *
 * Membership no longer comes from this object at all — it comes from
 * `GuildInstall` rows, seeded with {@link installGuild} — because the cache is
 * permanently empty on any role without a gateway, and this sweep runs as a
 * background Temporal Activity. `guilds.fetch` is a plain REST read and works
 * with or without a shard, so it stays the confirmation source. The cache is
 * left empty on purpose: nothing here may depend on it again.
 */
function discordClient(
  options: {
    // Guilds the API confirms membership for even though they have no live
    // install row (simulates a stale/missing row).
    verifiableIds?: string[];
  } = {},
) {
  const { verifiableIds = [] } = options;
  return mockClient({
    isReady: () => false,
    guilds: {
      cache: new Map(),
      fetch: (serverId: string) =>
        verifiableIds.includes(serverId)
          ? Promise.resolve(mockGuild({ id: serverId }))
          : Promise.reject(unknownGuildError()),
    },
  });
}

async function installGuild(
  db: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<void> {
  await db.guildInstall.create({
    data: {
      serverId,
      serverName: `guild-${serverId}`,
      ownerDiscordId: testAccountId("804"),
      addedByDiscordId: testAccountId("804"),
      memberCount: 10,
      installedAt: new Date("2026-01-01T00:00:00.000Z"),
      removedAt: null,
    },
  });
}

const day1 = new Date("2026-07-01T04:00:00.000Z");
const day2 = new Date("2026-07-02T04:00:00.000Z");
const sameDayLater = new Date("2026-07-01T20:00:00.000Z");
// 23:55 UTC on day1 to 00:05 UTC on day2 - a different calendar date but
// only 10 minutes apart, well within a normal transient outage.
const justBeforeMidnight = new Date("2026-07-01T23:55:00.000Z");
const justAfterMidnight = new Date("2026-07-02T00:05:00.000Z");

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.guildPermissionError.deleteMany();
  await prisma.bucksNotificationPreference.deleteMany();
  await prisma.guildRemovalCandidate.deleteMany();
  await prisma.guildInstall.deleteMany();
  // `memberGuild` is a guild Scout is still installed in.
  await installGuild(prisma, memberGuild);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reconcileRemovedGuilds", () => {
  test("discovers a removed guild whose only residual data is notification preferences", async () => {
    await prisma.bucksNotificationPreference.create({
      data: {
        serverId: removedGuild,
        discordId: testAccountId("803"),
      },
    });

    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: day1,
    });
    expect(
      await prisma.bucksNotificationPreference.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(1);

    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: day2,
    });
    expect(
      await prisma.bucksNotificationPreference.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(0);
  });

  test("does not clean up on the first day a guild is seen missing - only records a candidate", async () => {
    await seedGuild(prisma, removedGuild);

    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: day1,
    });

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
    expect(
      await prisma.guildRemovalCandidate.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(1);
  });

  test("does not clean up on a second same-day run - only a later day confirms", async () => {
    await seedGuild(prisma, removedGuild);

    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: day1,
    });
    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: sameDayLater,
    });

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
  });

  test("cleans up guilds only once a later day's run also sees them missing, keeps current ones", async () => {
    await seedGuild(prisma, memberGuild);
    await seedGuild(prisma, removedGuild);

    // Bot is only in memberGuild both days.
    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: day1,
    });
    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: day2,
    });

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(0);
    expect(
      await prisma.guildPermissionError.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(0);
    expect(
      await prisma.bucksNotificationPreference.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(0);
    expect(
      await prisma.guildRemovalCandidate.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(0);

    expect(
      await prisma.player.count({ where: { serverId: memberGuild } }),
    ).toBe(1);
  });

  test("still runs on a process that never connects a gateway", async () => {
    // The regression this replaces: candidacy came from `client.guilds.cache`
    // behind an `isReady()` early-return, so on a role with no gateway — which
    // is where this Activity actually runs — the sweep returned immediately and
    // removed guilds accumulated residual data forever. The client here is
    // never ready and has an empty cache, exactly like that role.
    await seedGuild(prisma, removedGuild);

    await reconcileRemovedGuilds(discordClient(), prisma, { now: day1 });
    await reconcileRemovedGuilds(discordClient(), prisma, { now: day2 });

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(0);
  });

  test("an empty install table nominates but never deletes on its own", async () => {
    // Nominating too eagerly is safe in a way an empty cache was not: a
    // nomination only records a sighting, and deletion still needs two
    // Discord-confirmed 10004s a day apart. A guild Discord vouches for is
    // cleared on the first run.
    await prisma.guildInstall.deleteMany();
    await seedGuild(prisma, memberGuild);

    await reconcileRemovedGuilds(
      discordClient({ verifiableIds: [memberGuild] }),
      prisma,
      { now: day1 },
    );

    expect(
      await prisma.player.count({ where: { serverId: memberGuild } }),
    ).toBe(1);
    expect(
      await prisma.guildRemovalCandidate.count({
        where: { serverId: memberGuild },
      }),
    ).toBe(0);
  });

  test("keeps data for a guild missing from cache but confirmed still a member via fetch (stale cache)", async () => {
    await seedGuild(prisma, removedGuild);

    // removedGuild isn't in the cache, but a live fetch confirms it's still
    // a real member — this is the exact scenario that caused the 2026-07
    // ScoutScheduledReportMissedWeekly incident.
    const client = discordClient({
      verifiableIds: [removedGuild],
    });
    await reconcileRemovedGuilds(client, prisma);

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
  });

  test("does not clean up when a repeat sighting crosses a UTC date boundary but less than a full day has elapsed", async () => {
    await seedGuild(prisma, removedGuild);

    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: justBeforeMidnight,
    });
    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: justAfterMidnight,
    });

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
    expect(
      await prisma.guildRemovalCandidate.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(1);
  });

  test("keeps data for a guild that recovers on a later day after an earlier sighting (transient outage)", async () => {
    await seedGuild(prisma, removedGuild);

    await reconcileRemovedGuilds(discordClient(), prisma, {
      now: day1,
    });
    // Day 2: the guild is reachable again - the outage resolved.
    const client = discordClient({
      verifiableIds: [removedGuild],
    });
    await reconcileRemovedGuilds(client, prisma, { now: day2 });

    expect(
      await prisma.player.count({ where: { serverId: removedGuild } }),
    ).toBe(1);
    expect(
      await prisma.guildRemovalCandidate.count({
        where: { serverId: removedGuild },
      }),
    ).toBe(0);
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
