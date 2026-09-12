/**
 * The hourly data-validation job's DELETION layer, against a real schema.
 *
 * `validate-data.test.ts` covers the decision — which guilds are orphaned —
 * with pure functions. Nothing covered what happens after that decision, which
 * is where the rows actually disappear: the blast radius of one guild's
 * cleanup, and what a partial failure leaves behind.
 *
 * The two properties pinned here both used to be violable. The three deletes
 * ran independently, so a fault after the first left a guild with no
 * subscriptions and an intact permission table; and the cleanup caught its own
 * errors, so the caller's per-guild handler could never run and a database
 * fault was recorded as a successful cleanup.
 */

import { Client, GatewayIntentBits } from "discord.js";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import type { DiscordChannel } from "#src/lib/discord/bot-rest-schemas.ts";
import {
  runDataValidation,
  type GuildValidationDependencies,
} from "#src/league/tasks/cleanup/validate-data.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("validate-data-deletion");

// Ascending, because the cleanup walks stored guilds in `serverId` order: the
// first id is the one a test can put a fault on and still prove the run
// reached the second.
const FIRST = testGuildId("11");
const SECOND = testGuildId("12");

const ACTOR = testAccountId("900");
const CHANNEL = testChannelId("100");

/** A live channel, so the channel half of the job deletes nothing. */
const liveChannel: DiscordChannel = {
  id: CHANNEL,
  name: "general",
  type: 0,
  guild_id: FIRST,
  permission_overwrites: [],
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function seedGuild(serverId: DiscordGuildId): Promise<void> {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: `player-${serverId}`,
      discordId: ACTOR,
      serverId,
      creatorDiscordId: ACTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.subscription.create({
    data: {
      playerId: player.id,
      channelId: CHANNEL,
      serverId,
      creatorDiscordId: ACTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.serverPermission.create({
    data: {
      serverId,
      discordUserId: ACTOR,
      permission: "CREATE_COMPETITION",
      grantedBy: ACTOR,
      grantedAt: now,
    },
  });
  await prisma.guildPermissionError.create({
    data: {
      serverId,
      channelId: CHANNEL,
      errorType: "channel_missing",
      firstOccurrence: now,
      lastOccurrence: now,
    },
  });
}

type GuildRowCounts = {
  subscriptions: number;
  permissions: number;
  permissionErrors: number;
};

async function countsFor(serverId: DiscordGuildId): Promise<GuildRowCounts> {
  const [subscriptions, permissions, permissionErrors] = await Promise.all([
    prisma.subscription.count({ where: { serverId } }),
    prisma.serverPermission.count({ where: { serverId } }),
    prisma.guildPermissionError.count({ where: { serverId } }),
  ]);
  return { subscriptions, permissions, permissionErrors };
}

const SEEDED: GuildRowCounts = {
  subscriptions: 1,
  permissions: 1,
  permissionErrors: 1,
};
const EMPTY: GuildRowCounts = {
  subscriptions: 0,
  permissions: 0,
  permissionErrors: 0,
};

function dependencies(input: {
  db?: ExtendedPrismaClient;
  /** Guilds Discord confirms Scout is still in. Everything else is orphaned. */
  present?: readonly string[];
  /** Guilds whose confirmation fails outright. */
  unreachable?: readonly string[];
}): GuildValidationDependencies {
  return {
    db: input.db ?? prisma,
    // No live install rows: every stored guild is a deletion candidate that
    // has to be confirmed against Discord one at a time.
    installedAmong: () => Promise.resolve(new Set()),
    isInstalled: (guildId) => {
      if (input.unreachable?.includes(guildId) === true) {
        return Promise.reject(
          new DiscordUpstreamError("http_error", "Discord is down", 503),
        );
      }
      return Promise.resolve(input.present?.includes(guildId) === true);
    },
    readChannel: () => Promise.resolve(liveChannel),
  };
}

/**
 * A client that fails one guild's permission-error delete.
 *
 * A Prisma query extension rather than a hand-rolled double: it runs inside
 * the real transaction, so the rollback under test is Postgres's own and not
 * something this file simulates.
 */
function faultOnPermissionErrorDelete(
  serverId: DiscordGuildId,
): ExtendedPrismaClient {
  return prisma.$extends({
    query: {
      guildPermissionError: {
        deleteMany({ args, query }) {
          if (args.where?.serverId === serverId) {
            throw new Error("simulated database fault");
          }
          return query(args);
        },
      },
    },
  });
}

beforeEach(async () => {
  await prisma.guildPermissionError.deleteMany();
  await prisma.serverPermission.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.player.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runDataValidation deletion blast radius", () => {
  test("a confirmed-gone guild loses its rows and only its rows", async () => {
    await seedGuild(FIRST);
    await seedGuild(SECOND);

    await runDataValidation(client, dependencies({ present: [SECOND] }));

    expect(await countsFor(FIRST)).toEqual(EMPTY);
    expect(await countsFor(SECOND)).toEqual(SEEDED);
  });

  test("a guild Discord still has keeps everything", async () => {
    await seedGuild(FIRST);

    await runDataValidation(client, dependencies({ present: [FIRST] }));

    expect(await countsFor(FIRST)).toEqual(SEEDED);
  });

  test("an unreachable Discord mid-batch deletes nothing at all", async () => {
    // The orphan list is resolved in full before the first delete, so an
    // outage on the second guild must not cost the first guild its rows —
    // "Scout could not ask" is never "Scout was removed".
    await seedGuild(FIRST);
    await seedGuild(SECOND);

    await expect(
      runDataValidation(client, dependencies({ unreachable: [SECOND] })),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);

    expect(await countsFor(FIRST)).toEqual(SEEDED);
    expect(await countsFor(SECOND)).toEqual(SEEDED);
  });
});

describe("runDataValidation partial-failure isolation", () => {
  test("a database fault leaves that guild whole and still clears the next", async () => {
    // FIRST is walked first and faults on the LAST of its three deletes, so
    // the two that already succeeded have to be rolled back — a guild with no
    // subscriptions but an intact permission table is exactly the half-state
    // the transaction exists to prevent.
    await seedGuild(FIRST);
    await seedGuild(SECOND);

    await runDataValidation(
      client,
      dependencies({ db: faultOnPermissionErrorDelete(FIRST) }),
    );

    expect(await countsFor(FIRST)).toEqual(SEEDED);
    // ...and the run kept going rather than dying on the first guild.
    expect(await countsFor(SECOND)).toEqual(EMPTY);
  });

  test("the whole batch failing still leaves every guild whole", async () => {
    await seedGuild(FIRST);
    await seedGuild(SECOND);

    await runDataValidation(
      client,
      dependencies({
        db: prisma.$extends({
          query: {
            guildPermissionError: {
              deleteMany() {
                throw new Error("simulated database fault");
              },
            },
          },
        }),
      }),
    );

    expect(await countsFor(FIRST)).toEqual(SEEDED);
    expect(await countsFor(SECOND)).toEqual(SEEDED);
  });
});
