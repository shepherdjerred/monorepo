import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as AccessModule from "#src/consumer/access.ts";
import {
  configureConsumerProfileFeatureTest,
  registerConsumerProfileFeatureTestLifecycle,
} from "#src/testing/consumer-profile-feature-test.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { recordLiveGameRoster } from "#src/live-roster/live-roster-record.ts";
import {
  LIVE_MATCH_ID,
  liveContext,
  seatPuuid,
} from "#src/live-roster/live-roster.test-fixtures.ts";

/**
 * The Live game endpoints read PostgreSQL and nothing else. The Riot client,
 * the spectator archive in S3 and the report lake are all rigged to fail the
 * moment a page view touches them, and `fetch` is counted.
 */
const external = vi.hoisted(() => {
  const riotCalls: string[] = [];
  const archiveReads: string[] = [];
  return { riotCalls, archiveReads, scopeUnavailable: false };
});
vi.mock("#src/league/api/api.ts", () => ({
  riotClient: new Proxy(
    {},
    {
      get: (_target, property) => {
        external.riotCalls.push(String(property));
        throw new Error("A Live game page view called Riot");
      },
    },
  ),
}));
vi.mock("#src/report-lake/receipted-archive.ts", async () => {
  const actual: object = await vi.importActual(
    "#src/report-lake/receipted-archive.ts",
  );
  return {
    ...actual,
    readArchivedPrematchSnapshot: (_descriptor: unknown, matchId: string) => {
      external.archiveReads.push(matchId);
      throw new Error("A Live game page view read S3");
    },
  };
});
vi.mock("#src/consumer/access.ts", async () => {
  const actual = await vi.importActual<typeof AccessModule>(
    "#src/consumer/access.ts",
  );
  return {
    ...actual,
    resolveConsumerGuildAccess: (
      ...args: Parameters<typeof actual.resolveConsumerGuildAccess>
    ) =>
      external.scopeUnavailable
        ? Promise.resolve({ kind: "unavailable" as const })
        : actual.resolveConsumerGuildAccess(...args),
  };
});

const guildId = DiscordGuildIdSchema.parse("100000000000000051");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000052");
const profileFeature = configureConsumerProfileFeatureTest([
  guildId,
  otherGuildId,
]);
const trpc = await createOfflineTrpcHarness("trpc-consumer-live-test");
const { prisma: testPrisma } = trpc;
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000051");

const DETECTED_AT = new Date();
// A second game, with only a friend of the other server in it.
const OTHER_GAME = RiotMatchIdSchema.parse("NA1_5500000888");

async function seedPlayer(
  alias: string,
  serverId: DiscordGuildId,
  puuid: LeaguePuuid,
) {
  const now = new Date();
  const player = await testPrisma.player.create({
    data: {
      alias,
      serverId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
  await testPrisma.account.create({
    data: {
      alias: `${alias}-main`,
      puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId: actorDiscordId,
      riotGameName: alias,
      riotTagLine: "NA1",
      riotIdUpdatedAt: now,
      lastMatchTime: now,
      lastCheckedAt: now,
      createdTime: now,
      updatedTime: now,
    },
  });
  return player;
}

/** The lobby with RiverQuartz (seat 2) in it, strangers' form partly fetched. */
async function seedLobby() {
  await recordLiveGameRoster(liveContext([2]), DETECTED_AT, testPrisma);
  await testPrisma.$executeRaw`
    UPDATE "LiveGameRoster"
    SET "recentForm" = jsonb_build_object(
      ${seatPuuid(6)}::text,
      jsonb_build_object(
        'status', 'fetched', 'games', 5, 'wins', 5,
        'streak', jsonb_build_object('result', 'win', 'length', 5),
        'gamesOnChampion', 2, 'winsOnChampion', 2, 'rank', NULL,
        'fetchedAt', ${DETECTED_AT.toISOString()}::text))`;
}

registerConsumerProfileFeatureTestLifecycle({
  feature: profileFeature,
  prepare: async () => {
    external.riotCalls.length = 0;
    external.archiveReads.length = 0;
    external.scopeUnavailable = false;
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await testPrisma.liveGameRoster.deleteMany();
    await testPrisma.matchTrackedAccount.deleteMany();
    await testPrisma.account.deleteMany();
    await testPrisma.player.deleteMany();
    await profileFeature.resetLake();
  },
  cleanup: async () => {
    await testPrisma.$disconnect();
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumerLive scope", () => {
  test("forbidden when the rollout is off, with no shared server, or signed out", async () => {
    await expect(trpc.authedCaller().consumerLive.list()).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(
      trpc.authedCaller().consumerLive.game({ riotMatchId: LIVE_MATCH_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    profileFeature.enable(guildId);
    trpc.setMembership([
      {
        guildId: DiscordGuildIdSchema.parse("100000000000000099"),
        asAdmin: false,
      },
    ]);
    await expect(trpc.authedCaller().consumerLive.list()).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );

    await expect(trpc.anonCaller().consumerLive.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  test("unavailable, not forbidden, when Scout cannot verify the viewer's servers", async () => {
    profileFeature.enable(guildId);
    external.scopeUnavailable = true;

    await expect(trpc.authedCaller().consumerLive.list()).rejects.toMatchObject(
      { code: "SERVICE_UNAVAILABLE" },
    );
    await expect(
      trpc.authedCaller().consumerLive.game({ riotMatchId: LIVE_MATCH_ID }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  test("a server outside the viewer's scope is not found", async () => {
    profileFeature.enable(guildId);
    await expect(
      trpc.authedCaller().consumerLive.list({ guildId: otherGuildId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("consumerLive.list", () => {
  test("lists only live games with a friend in the viewer's servers", async () => {
    profileFeature.enable(guildId, otherGuildId);
    const friend = await seedPlayer("RiverQuartz", guildId, seatPuuid(2));
    await seedPlayer("Elsewhere", otherGuildId, seatPuuid(6));
    await seedLobby();
    // A game only the other server's friend is in.
    await recordLiveGameRoster(
      { ...liveContext([6]), riotMatchId: OTHER_GAME },
      DETECTED_AT,
      testPrisma,
    );

    const games = await trpc.authedCaller().consumerLive.list();
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      riotMatchId: LIVE_MATCH_ID,
      queueId: 420,
      friends: [
        { playerId: friend.id, alias: "RiverQuartz", championId: 103, guildId },
      ],
    });

    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    expect(await trpc.authedCaller().consumerLive.list()).toHaveLength(2);
    expect(
      await trpc.authedCaller().consumerLive.list({ guildId: otherGuildId }),
    ).toHaveLength(1);
  });

  test("a game whose match has been recorded is no longer live", async () => {
    profileFeature.enable(guildId);
    await seedPlayer("RiverQuartz", guildId, seatPuuid(2));
    await seedLobby();
    await testPrisma.matchTrackedAccount.create({
      data: { riotMatchId: LIVE_MATCH_ID, puuid: seatPuuid(2) },
    });

    expect(await trpc.authedCaller().consumerLive.list()).toEqual([]);
  });
});

describe("consumerLive.game", () => {
  test("returns the lobby with friends named and strangers reduced to a summary", async () => {
    profileFeature.enable(guildId);
    const friend = await seedPlayer("RiverQuartz", guildId, seatPuuid(2));
    await seedLobby();

    const game = await trpc
      .authedCaller()
      .consumerLive.game({ riotMatchId: LIVE_MATCH_ID });

    expect(game).toMatchObject({
      riotMatchId: LIVE_MATCH_ID,
      queueId: 420,
      ended: false,
      recentFormComplete: false,
    });
    expect(game.participants).toHaveLength(10);
    expect(game.participants[2]).toMatchObject({
      riotId: "RiverQuartz#NA1",
      championId: 103,
      keystoneId: 8114,
      friend: { playerId: friend.id, alias: "RiverQuartz" },
      recentForm: null,
    });
    expect(game.participants[6]).toMatchObject({
      riotId: "Hushwing#NA1",
      friend: null,
      recentForm: { status: "fetched", wins: 5, gamesOnChampion: 2 },
    });
    // Not fetched yet: present, with no form, and no rank captured.
    expect(game.participants[7]).toMatchObject({
      friend: null,
      recentForm: null,
      rank: null,
    });
    // A stranger's PUUID never reaches the browser.
    const wire = JSON.stringify(game);
    for (const seat of [0, 1, 3, 4, 5, 6, 7, 8, 9]) {
      expect(wire).not.toContain(seatPuuid(seat));
    }
  });

  test("a game that just ended still resolves, marked ended", async () => {
    profileFeature.enable(guildId);
    await seedPlayer("RiverQuartz", guildId, seatPuuid(2));
    await seedLobby();
    await testPrisma.matchTrackedAccount.create({
      data: { riotMatchId: LIVE_MATCH_ID, puuid: seatPuuid(2) },
    });

    expect(
      await trpc
        .authedCaller()
        .consumerLive.game({ riotMatchId: LIVE_MATCH_ID }),
    ).toMatchObject({ ended: true });
  });

  test("a game the viewer has no friend in, and a game that does not exist, answer alike", async () => {
    profileFeature.enable(guildId, otherGuildId);
    await seedPlayer("Elsewhere", otherGuildId, seatPuuid(6));
    await recordLiveGameRoster(
      { ...liveContext([6]), riotMatchId: OTHER_GAME },
      DETECTED_AT,
      testPrisma,
    );

    for (const riotMatchId of [OTHER_GAME, LIVE_MATCH_ID]) {
      await expect(
        trpc.authedCaller().consumerLive.game({ riotMatchId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Game was not found",
      });
    }
  });
});

describe("a page view", () => {
  test("makes no Riot call, no S3 read and no network request", async () => {
    profileFeature.enable(guildId);
    await seedPlayer("RiverQuartz", guildId, seatPuuid(2));
    await seedLobby();
    const network = vi.spyOn(globalThis, "fetch");

    await trpc.authedCaller().consumerLive.list();
    await trpc.authedCaller().consumerLive.game({ riotMatchId: LIVE_MATCH_ID });

    expect(external.riotCalls).toEqual([]);
    expect(external.archiveReads).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });
});
