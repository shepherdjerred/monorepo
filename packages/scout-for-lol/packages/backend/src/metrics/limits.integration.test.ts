import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { updateLimitMetrics } from "#src/metrics/limits.ts";
import {
  serversApproachingAccountLimit,
  serversApproachingSubscriptionLimit,
  serversAtAccountLimit,
  serversAtSubscriptionLimit,
} from "#src/metrics/index.ts";
import { gaugeValue } from "#src/testing/gauge-values.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

/**
 * The limit gauges, counted from a real Postgres.
 *
 * The sweep reads every server's usage in grouped queries; a `groupBy` with a
 * relation filter is exactly the shape that typechecks and then counts the
 * wrong rows, so the per-server classification is asserted against seeded
 * data at, near and below the default limits (75 subscribed players, 50
 * accounts, warning 5 slots early).
 */

const { prisma: db } = createTestDatabase("limit-metrics");
const NOW = new Date();
const CREATOR = DiscordAccountIdSchema.parse("100000000000000001");
const CHANNEL = DiscordChannelIdSchema.parse("200000000000000001");

async function clearAll(): Promise<void> {
  await db.subscription.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

async function seedServer(
  server: string,
  shape: { subscribedPlayers: number; idlePlayers: number; accounts: number },
): Promise<void> {
  const serverId = DiscordGuildIdSchema.parse(server);
  const total = shape.subscribedPlayers + shape.idlePlayers;
  for (let index = 0; index < total; index++) {
    const player = await db.player.create({
      data: {
        alias: `player-${index.toString()}`,
        serverId,
        creatorDiscordId: CREATOR,
        createdTime: NOW,
        updatedTime: NOW,
      },
    });
    if (index < shape.subscribedPlayers) {
      await db.subscription.create({
        data: {
          playerId: player.id,
          channelId: CHANNEL,
          serverId,
          creatorDiscordId: CREATOR,
          createdTime: NOW,
          updatedTime: NOW,
        },
      });
    }
    // Every account hangs off the server's first player; only the per-server
    // total matters to the limit.
    if (index === 0) {
      await db.account.createMany({
        data: Array.from({ length: shape.accounts }, (_, account) => ({
          alias: `account-${account.toString()}`,
          puuid: testPuuid(`${serverId.slice(-1)}-${account.toString()}`),
          region: "AMERICA_NORTH",
          playerId: player.id,
          serverId,
          creatorDiscordId: CREATOR,
          createdTime: NOW,
          updatedTime: NOW,
        })),
      });
    }
  }
}

async function value(
  gauge: Parameters<typeof gaugeValue>[0],
): Promise<number | undefined> {
  return await gaugeValue(gauge, {});
}

describe("updateLimitMetrics", () => {
  test("classifies each server by its own subscribed players and accounts", async () => {
    // At the subscription limit, with idle players that must not count.
    await seedServer("300000000000000001", {
      subscribedPlayers: 75,
      idlePlayers: 3,
      accounts: 1,
    });
    // Within the warning window for both limits.
    await seedServer("300000000000000002", {
      subscribedPlayers: 71,
      idlePlayers: 0,
      accounts: 46,
    });
    // At the account limit.
    await seedServer("300000000000000003", {
      subscribedPlayers: 0,
      idlePlayers: 1,
      accounts: 50,
    });
    // Comfortably below everything.
    await seedServer("300000000000000004", {
      subscribedPlayers: 2,
      idlePlayers: 2,
      accounts: 3,
    });

    await updateLimitMetrics(db);

    expect(await value(serversAtSubscriptionLimit)).toBe(1);
    expect(await value(serversApproachingSubscriptionLimit)).toBe(1);
    expect(await value(serversAtAccountLimit)).toBe(1);
    expect(await value(serversApproachingAccountLimit)).toBe(1);
  });
});
