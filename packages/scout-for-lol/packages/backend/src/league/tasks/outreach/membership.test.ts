/**
 * Outreach only DMs installers of servers Scout is actually still in.
 *
 * The membership check used to be `client.guilds.cache.has(guildId)`. Outreach
 * runs as a background Temporal Activity, so on a role without a gateway that
 * cache is permanently empty — every install was skipped as `not_a_member` and
 * outreach silently stopped altogether. Nobody would have noticed: the job
 * still "succeeded" every hour, just with a skip count equal to the install
 * count.
 */

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import { runOutreach } from "#src/league/tasks/outreach/index.ts";
import { mockClient } from "#src/testing/discord-mocks.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("outreach-membership");

const stillInstalled = testGuildId("721");
const alreadyRemoved = testGuildId("722");

/** Empty cache, never ready — exactly what a gatewayless role's client is. */
function gatewaylessClient() {
  return mockClient({
    isReady: () => false,
    guilds: { cache: new Map() },
  });
}

async function seedInstall(serverId: DiscordGuildId): Promise<void> {
  await prisma.guildInstall.create({
    data: {
      serverId,
      serverName: `guild-${serverId}`,
      ownerDiscordId: testAccountId("723"),
      addedByDiscordId: testAccountId("723"),
      memberCount: 10,
      // Long enough ago that the outreach ladder would have something to say.
      installedAt: new Date("2026-01-01T00:00:00.000Z"),
      removedAt: null,
    },
  });
}

beforeEach(async () => {
  await prisma.guildInstall.deleteMany();
});

afterAll(async () => {
  await prisma.guildInstall.deleteMany();
  await prisma.$disconnect();
});

describe("outreach membership", () => {
  test("asks the install port about every live install, with no gateway", async () => {
    await seedInstall(stillInstalled);
    await seedInstall(alreadyRemoved);
    const asked: string[] = [];

    await runOutreach(gatewaylessClient(), {
      dryRun: true,
      db: prisma,
      isInstalled: (guildId) => {
        asked.push(guildId);
        return Promise.resolve(guildId === stillInstalled);
      },
    });

    // Both installs reach the membership check. Under the old cache read this
    // list would have been asked of an empty Map and every guild skipped.
    expect(asked.toSorted()).toEqual(
      [alreadyRemoved, stillInstalled].toSorted(),
    );
  });

  test("a guild Scout has left is still skipped", async () => {
    // The check exists because GuildInstall rows outlive a removal on purpose,
    // so this must keep failing closed for a server Scout is no longer in.
    await seedInstall(alreadyRemoved);
    const considered: string[] = [];

    await runOutreach(gatewaylessClient(), {
      dryRun: true,
      db: prisma,
      isInstalled: (guildId) => {
        considered.push(guildId);
        return Promise.resolve(false);
      },
    });

    expect(considered).toEqual([DiscordGuildIdSchema.parse(alreadyRemoved)]);
  });

  test("no installs means no membership questions", async () => {
    const asked: string[] = [];

    await runOutreach(gatewaylessClient(), {
      dryRun: true,
      db: prisma,
      isInstalled: (guildId) => {
        asked.push(guildId);
        return Promise.resolve(true);
      },
    });

    expect(asked).toEqual([]);
  });
});
