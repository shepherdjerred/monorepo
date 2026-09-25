import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { fullPrematchRosterFixture } from "#src/testing/raw-capture-fixtures.ts";

/**
 * Who the prematch announcement is owed to, in a process whose Discord guild
 * cache does not hold the guild that registered the player.
 *
 * The capture's roster is not a workload — it is the audience. It decides which
 * channels `recordPrematchDeliveryIntentsV2` mints durable intent rows for, and
 * `planPrematchFanOutV2` fans out only the rows that were minted, so a roster
 * narrowed at capture time is not recovered later: the completed game-scoped
 * Workflow ID refuses every subsequent poll.
 *
 * The narrowing was `getActiveServerIds()`, a read of the gateway's guild cache,
 * which answers `undefined` — no filter — in a process owning no gateway and a
 * narrowed set in one that does. These tests pin the roster against the cache
 * rather than against a mocked resolver, so re-introducing that filter fails
 * them.
 *
 * The seeded shape is the one that makes the hazard all-or-nothing rather than
 * partial: ONE Riot identity registered in TWO guilds, since `Account` is unique
 * on `(serverId, puuid)` and `getChannelsSubscribedToPlayers` looks accounts up
 * by puuid with no guild scope at all.
 */

const { prisma } = createTestDatabase("scout-v2-prematch-audience");

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

const cache = vi.hoisted((): { active: Set<string> | undefined } => ({
  active: undefined,
}));

// The mutation surface. After the fix nothing consults this; re-adding
// `getActiveServerIds()` to `trackedAccountConfigs` makes it decide the roster
// again, and every assertion below turns on that.
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: () => cache.active,
}));

const spectator = vi.hoisted((): { answer: unknown } => ({
  answer: undefined,
}));

vi.mock("#src/league/api/spectator.ts", () => ({
  getActiveGame: () => Promise.resolve(spectator.answer),
}));

const { getChannelsSubscribedToPlayers } =
  await import("#src/database/index.ts");
const {
  prematchContextFrom,
  resolveScoutV2PrematchContext,
  trackedAccountConfigs,
} = await import("#src/temporal/v2/prematch/prematch-context.ts");
const { ScoutPrematchGameRefSchema } =
  await import("@scout-for-lol/temporal/contracts-v2");
const { DiscordAccountIdSchema, DiscordChannelIdSchema, DiscordGuildIdSchema } =
  await import("@scout-for-lol/domain/identity/discord.ts");

const PUUID = LeaguePuuidSchema.parse("a".repeat(78));
const MATCH_ID = RiotMatchIdSchema.parse("NA1_5500000001");

/** The two guilds that each registered this identity and subscribed to it. */
const HOME_GUILD = DiscordGuildIdSchema.parse("3".repeat(18));
const OTHER_GUILD = DiscordGuildIdSchema.parse("4".repeat(18));
/** A guild in the cache that has nothing to do with this player. */
const UNRELATED_GUILD = DiscordGuildIdSchema.parse("5".repeat(18));

const HOME_CHANNEL = DiscordChannelIdSchema.parse("600000000000000001");
const OTHER_CHANNEL = DiscordChannelIdSchema.parse("600000000000000002");

const REGISTRANT = DiscordAccountIdSchema.parse("1".repeat(18));
const CREATOR = DiscordAccountIdSchema.parse("2".repeat(18));

async function registerIn(
  serverId: typeof HOME_GUILD,
  channelId: typeof HOME_CHANNEL,
): Promise<void> {
  const player = await prisma.player.create({
    data: {
      alias: `tracked-${serverId.slice(0, 2)}`,
      discordId: REGISTRANT,
      serverId,
      creatorDiscordId: CREATOR,
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
  await prisma.account.create({
    data: {
      alias: player.alias,
      puuid: PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId: CREATOR,
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
  await prisma.subscription.create({
    data: {
      playerId: player.id,
      channelId,
      serverId,
      creatorDiscordId: CREATOR,
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
}

async function audienceChannels(): Promise<string[]> {
  const context = prematchContextFrom(
    fullPrematchRosterFixture([PUUID]),
    await trackedAccountConfigs(prisma),
    MATCH_ID,
  );
  const subscribed = await getChannelsSubscribedToPlayers(
    context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
    prisma,
  );
  return subscribed.map((entry) => entry.channel).toSorted();
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.subscription.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.player.deleteMany({});
  cache.active = undefined;
  spectator.answer = undefined;
  await registerIn(HOME_GUILD, HOME_CHANNEL);
  await registerIn(OTHER_GUILD, OTHER_CHANNEL);
});

describe("the prematch capture's roster", () => {
  test("is the same answer in a process holding the guilds and one holding none", async () => {
    cache.active = new Set([HOME_GUILD, OTHER_GUILD]);
    const holdsThem = await trackedAccountConfigs(prisma);

    cache.active = new Set([UNRELATED_GUILD]);
    const holdsNone = await trackedAccountConfigs(prisma);

    // The whole point of the change, stated as the invariant rather than as an
    // outcome: two processes with different gateway cache state must not answer
    // this question differently, because the answer becomes a durable fact
    // about which channels are owed an announcement.
    expect(holdsNone).toEqual(holdsThem);
    expect(
      holdsThem.map((config) => config.league.leagueAccount.puuid),
    ).toEqual([PUUID, PUUID]);
  });

  test("keeps the whole audience when no guild holding the identity is cached", async () => {
    cache.active = new Set([UNRELATED_GUILD]);

    // The unrecoverable case. Every guild registering this puuid is absent, so
    // a cache-filtered roster dropped the identity whole — and the channel in
    // the guild Scout is still in lost its announcement along with it, silently
    // and for good.
    expect(await audienceChannels()).toEqual(
      [HOME_CHANNEL, OTHER_CHANNEL].toSorted(),
    );
  });

  test("was never harmed by a partially cached identity", async () => {
    cache.active = new Set([OTHER_GUILD]);

    // Characterisation, not a proof of the fix: this passed before it too.
    // `getChannelsSubscribedToPlayers` has no guild scope, so one surviving
    // `Account` row reaches every guild's subscriptions and dropping the other
    // copy changes nothing. It is here because it is what makes the hazard
    // all-or-nothing per identity, and because scoping that lookup by guild
    // later would break it — which is the correct place to find that out.
    expect(await audienceChannels()).toEqual(
      [HOME_CHANNEL, OTHER_CHANNEL].toSorted(),
    );
  });

  test("resolves a game surfaced by an account whose guild is not cached", async () => {
    cache.active = new Set([UNRELATED_GUILD]);
    spectator.answer = {
      kind: "in-game",
      game: fullPrematchRosterFixture([PUUID]),
    };

    // Discovery pins the game reference to whichever account surfaced it, and
    // this resolver fails NON-RETRYABLY on a puuid it cannot find. A discovery
    // set wider than the capture's is therefore a terminal capture failure for
    // a reason unrelated to the game. Reading every tracked account makes the
    // capture a superset of any filtered discovery set by construction.
    const context = await resolveScoutV2PrematchContext(
      ScoutPrematchGameRefSchema.parse({
        puuid: PUUID,
        platform: "NA1",
        gameId: "5500000001",
      }),
    );

    expect(context?.riotMatchId).toBe(MATCH_ID);
    expect(
      context?.trackedPlayers.map(
        (player) => player.league.leagueAccount.puuid,
      ),
    ).toEqual([PUUID, PUUID]);
  });
});
