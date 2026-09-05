import { describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import {
  configureConsumerProfileFeatureTest,
  registerConsumerProfileFeatureTestLifecycle,
} from "#src/testing/consumer-profile-feature-test.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { writeTestLake } from "#src/testing/test-report-lake.ts";

const guildId = DiscordGuildIdSchema.parse("100000000000000041");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000042");
const profileFeature = configureConsumerProfileFeatureTest([
  guildId,
  otherGuildId,
]);

const trpc = await createOfflineTrpcHarness("trpc-consumer-player-test");
const { prisma: testPrisma } = trpc;
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000041");
const { lakeDir } = profileFeature;
const MAIN = testPuuid("consumer-main");
const ALT = testPuuid("consumer-alt");
const OTHER = testPuuid("consumer-other");
const gameCreatedAt = new Date(Date.UTC(2026, 7, 20, 12, 0, 0));

async function seedPlayer(options: {
  serverId: DiscordGuildId;
  alias: string;
  discordId?: DiscordAccountId;
  puuids: LeaguePuuid[];
  lastMatchTime?: Date | null;
}) {
  const now = new Date();
  const player = await testPrisma.player.create({
    data: {
      alias: options.alias,
      ...(options.discordId === undefined
        ? {}
        : { discordId: options.discordId }),
      serverId: options.serverId,
      creatorDiscordId: actorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
  await testPrisma.account.createMany({
    data: options.puuids.map((puuid, index) => ({
      alias: `${options.alias}-${index.toString()}`,
      puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: options.serverId,
      creatorDiscordId: actorDiscordId,
      riotGameName: `${options.alias} Riot ${index.toString()}`,
      riotTagLine: "NA1",
      riotIdUpdatedAt: now,
      lastMatchTime:
        options.lastMatchTime === undefined ? now : options.lastMatchTime,
      lastCheckedAt: now,
      createdTime: now,
      updatedTime: now,
    })),
  });
  return player;
}

function matchFact(options: {
  matchId: string;
  puuid: string;
  playerId: number;
  queue?: string | null;
  gameCreationAt?: Date;
}) {
  return {
    playerId: options.playerId,
    playerAlias: "Consumer Player",
    matchId: options.matchId,
    puuid: options.puuid,
    queue: options.queue === undefined ? "solo" : options.queue,
    win: true,
    surrendered: false,
    kills: 7,
    deaths: 2,
    assists: 5,
    teamId: 100,
    gameCreationAt: options.gameCreationAt ?? gameCreatedAt,
  };
}

function enableProfiles(...guildIds: DiscordGuildId[]): void {
  profileFeature.enable(...guildIds);
}

registerConsumerProfileFeatureTestLifecycle({
  feature: profileFeature,
  prepare: async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await testPrisma.matchRankHistory.deleteMany();
    await testPrisma.account.deleteMany();
    await testPrisma.player.deleteMany();
    await profileFeature.resetLake();
  },
  cleanup: async () => {
    await testPrisma.$disconnect();
  },
});

describe("consumerPlayer.status", () => {
  test("distinguishes shared membership from a disabled rollout", async () => {
    await expect(trpc.authedCaller().consumerPlayer.status()).resolves.toEqual({
      state: "feature_disabled",
    });

    enableProfiles(guildId);
    await expect(trpc.authedCaller().consumerPlayer.status()).resolves.toEqual({
      state: "available",
      guildCount: 1,
    });
  });

  test("requires authentication and a shared allowlisted guild", async () => {
    enableProfiles(guildId);
    await expect(trpc.anonCaller().consumerPlayer.status()).rejects.toThrow();

    trpc.setMembership([{ guildId: "100000000000000099", asAdmin: false }]);
    await expect(trpc.authedCaller().consumerPlayer.status()).resolves.toEqual({
      state: "no_shared_guild",
    });
  });

  test("reports rollout availability for the requested guild", async () => {
    enableProfiles(guildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);

    await expect(
      trpc.authedCaller().consumerPlayer.status({ guildId }),
    ).resolves.toEqual({
      state: "available",
      guildCount: 1,
    });
    await expect(
      trpc.authedCaller().consumerPlayer.status({ guildId: otherGuildId }),
    ).resolves.toEqual({ state: "feature_disabled" });
  });
});

describe("consumerPlayer search and direct lookup", () => {
  test("searches aliases and Riot IDs only in enabled shared guilds", async () => {
    enableProfiles(guildId);
    const visible = await seedPlayer({
      serverId: guildId,
      alias: "Visible Alias",
      puuids: [MAIN],
    });
    await seedPlayer({
      serverId: otherGuildId,
      alias: "Hidden Alias",
      puuids: [OTHER],
    });
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);

    const byAlias = await trpc
      .authedCaller()
      .consumerPlayer.search({ query: "Alias" });
    expect(byAlias.results.map((result) => result.playerId)).toEqual([
      visible.id,
    ]);

    const byRiotId = await trpc
      .authedCaller()
      .consumerPlayer.search({ query: "Visible Alias Riot 0#NA1" });
    expect(byRiotId.results).toHaveLength(1);
    const byPartialRiotId = await trpc
      .authedCaller()
      .consumerPlayer.search({ query: "visible alias riot 0" });
    expect(byPartialRiotId.results.map((result) => result.playerId)).toEqual([
      visible.id,
    ]);
    expect(Object.keys(byRiotId.results[0] ?? {})).toEqual([
      "playerId",
      "alias",
      "guild",
      "accounts",
    ]);
    expect(byRiotId.results[0]?.guild).toEqual({ name: "test-guild" });
    expect(JSON.stringify(byRiotId.results[0])).not.toContain(guildId);
  });

  test("ranks exact, prefix, substring, and fuzzy alias matches", async () => {
    enableProfiles(guildId);
    const exact = await seedPlayer({
      serverId: guildId,
      alias: "Northstar",
      puuids: [testPuuid("consumer-search-exact")],
    });
    const prefix = await seedPlayer({
      serverId: guildId,
      alias: "Northstar Prime",
      puuids: [testPuuid("consumer-search-prefix")],
    });
    const substring = await seedPlayer({
      serverId: guildId,
      alias: "The Northstar Club",
      puuids: [testPuuid("consumer-search-substring")],
    });
    const fuzzy = await seedPlayer({
      serverId: guildId,
      alias: "Northstir",
      puuids: [testPuuid("consumer-search-fuzzy")],
    });

    const ranked = await trpc
      .authedCaller()
      .consumerPlayer.search({ query: "nOrThStAr" });
    expect(ranked.results.map((result) => result.playerId)).toEqual([
      exact.id,
      prefix.id,
      substring.id,
      fuzzy.id,
    ]);

    const typo = await trpc
      .authedCaller()
      .consumerPlayer.search({ query: "Nortstar" });
    expect(typo.results.map((result) => result.playerId)).toContain(exact.id);
  });

  test("keeps one-character search and returns a deterministic maximum of twenty", async () => {
    enableProfiles(guildId);
    for (let index = 0; index < 22; index += 1) {
      const suffix = index.toString().padStart(2, "0");
      await seedPlayer({
        serverId: guildId,
        alias: `Search ${suffix}`,
        puuids: [testPuuid(`consumer-search-limit-${suffix}`)],
      });
    }

    const oneCharacter = await trpc
      .authedCaller()
      .consumerPlayer.search({ query: "S" });
    expect(oneCharacter.results).toHaveLength(20);
    expect(oneCharacter.results.map((result) => result.alias)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `Search ${index.toString().padStart(2, "0")}`,
      ),
    );
  });

  test("a guessed player ID across the boundary reveals nothing", async () => {
    enableProfiles(guildId);
    const hidden = await seedPlayer({
      serverId: otherGuildId,
      alias: "Secret Alias",
      discordId: DiscordAccountIdSchema.parse("300000000000000099"),
      puuids: [OTHER],
    });

    await expect(
      trpc
        .authedCaller()
        .consumerPlayer.profileSummary({ playerId: hidden.id }),
    ).rejects.toThrow("Player was not found");
    await expect(
      trpc
        .authedCaller()
        .consumerPlayer.matchHistory({ playerId: hidden.id, limit: 20 }),
    ).rejects.toThrow("Player was not found");
  });

  test("lost membership is enforced on the next request", async () => {
    enableProfiles(guildId);
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Departing Member",
      puuids: [MAIN],
    });
    await expect(
      trpc
        .authedCaller()
        .consumerPlayer.profileSummary({ playerId: player.id }),
    ).resolves.toBeDefined();

    trpc.setMembership([]);
    await expect(
      trpc
        .authedCaller()
        .consumerPlayer.profileSummary({ playerId: player.id }),
    ).rejects.toThrow(/not available/i);
  });
});

describe("consumerPlayer.home", () => {
  test("returns every viewer-linked profile and six newest non-self players", async () => {
    enableProfiles(guildId, otherGuildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    const mineOne = await seedPlayer({
      serverId: guildId,
      alias: "Mine One",
      discordId: actorDiscordId,
      puuids: [testPuuid("home-mine-one")],
    });
    const mineTwo = await seedPlayer({
      serverId: otherGuildId,
      alias: "Mine Two",
      discordId: actorDiscordId,
      puuids: [testPuuid("home-mine-two")],
    });
    const recent: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const player = await seedPlayer({
        serverId: guildId,
        alias: `Recent ${index.toString()}`,
        puuids: [testPuuid(`home-recent-${index.toString()}`)],
        lastMatchTime: new Date(gameCreatedAt.getTime() - index * 60_000),
      });
      recent.push(player.id);
    }
    await seedPlayer({
      serverId: guildId,
      alias: "Never active",
      puuids: [testPuuid("home-never")],
      lastMatchTime: null,
    });

    const home = await trpc.authedCaller(actorDiscordId).consumerPlayer.home();
    expect(
      home.yourProfiles
        .map((player) => player.playerId)
        .toSorted((left, right) => left - right),
    ).toEqual([mineOne.id, mineTwo.id].toSorted((left, right) => left - right));
    expect(home.recentPlayers.map((player) => player.playerId)).toEqual(
      recent.slice(0, 6),
    );
    expect(JSON.stringify(home)).not.toContain(actorDiscordId);
  });

  test("rechecks the feature flag for the home request", async () => {
    await expect(trpc.authedCaller().consumerPlayer.home()).rejects.toThrow(
      /not available/i,
    );
  });
});

describe("consumerPlayer combined profile", () => {
  test("returns safe account freshness, ranks, and match attribution", async () => {
    enableProfiles(guildId);
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Combined Player",
      discordId: DiscordAccountIdSchema.parse("300000000000000098"),
      puuids: [MAIN, ALT],
    });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        matchFact({ matchId: "NA1_main", puuid: MAIN, playerId: player.id }),
        matchFact({
          matchId: "NA1_alt",
          puuid: ALT,
          playerId: player.id,
          queue: "flex",
        }),
      ],
    });
    await testPrisma.matchRankHistory.createMany({
      data: [
        {
          matchId: "NA1_main",
          puuid: MAIN,
          queueType: "solo",
          rankAfter: JSON.stringify({
            tier: "gold",
            division: 2,
            lp: 55,
            wins: 12,
            losses: 8,
          }),
          capturedAt: gameCreatedAt,
        },
        {
          matchId: "NA1_alt",
          puuid: ALT,
          queueType: "flex",
          rankAfter: JSON.stringify({
            tier: "silver",
            division: 1,
            lp: 20,
            wins: 7,
            losses: 4,
          }),
          capturedAt: gameCreatedAt,
        },
      ],
    });

    const caller = trpc.authedCaller();
    const summary = await caller.consumerPlayer.profileSummary({
      playerId: player.id,
    });
    expect(summary.accountCount).toBe(2);
    expect(summary.accounts).toHaveLength(2);
    expect(summary.accounts[0]?.lastCheckedAt).toBeInstanceOf(Date);
    expect(summary.accounts[0]?.ranks.solo?.tier).toBe("gold");
    expect(summary.accounts[1]?.ranks.flex?.tier).toBe("silver");
    expect(summary.recentForm?.games).toBe(2);
    expect(summary.championPool[0]?.lowSample).toBe(true);
    expect(Object.keys(summary)).not.toContain("discordId");

    const history = await caller.consumerPlayer.matchHistory({
      playerId: player.id,
      limit: 1,
    });
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.account.gameName).toMatch(
      /Combined Player Riot/,
    );
    expect(history.nextCursor).not.toBeNull();

    const flexHistory = await caller.consumerPlayer.matchHistory({
      playerId: player.id,
      limit: 20,
      queues: ["flex"],
    });
    expect(flexHistory.entries.map((entry) => entry.matchId)).toEqual([
      "NA1_alt",
    ]);
  });

  test("combines queues, preserves all-game null queues, and stops at the selected window", async () => {
    enableProfiles(guildId);
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Windowed Player",
      puuids: [MAIN],
    });
    const facts = Array.from({ length: 55 }, (_, index) =>
      matchFact({
        matchId: `NA1_window_${index.toString().padStart(2, "0")}`,
        puuid: MAIN,
        playerId: player.id,
        queue: index === 54 ? null : index % 2 === 0 ? "solo" : "flex",
        gameCreationAt: new Date(gameCreatedAt.getTime() - index * 60_000),
      }),
    );
    await writeTestLake(lakeDir, { serverId: guildId, matchFacts: facts });

    const caller = trpc.authedCaller();
    const lastTwenty = await caller.consumerPlayer.matchHistory({
      playerId: player.id,
      limit: 50,
    });
    expect(lastTwenty.entries).toHaveLength(20);
    expect(lastTwenty.nextCursor).toBeNull();

    const lastFifty = await caller.consumerPlayer.matchHistory({
      playerId: player.id,
      games: 50,
      limit: 50,
      queues: ["solo", "flex"],
    });
    expect(lastFifty.entries).toHaveLength(50);
    expect(lastFifty.nextCursor).toBeNull();

    const allTime = await caller.consumerPlayer.matchHistory({
      playerId: player.id,
      games: "all",
      limit: 50,
    });
    expect(allTime.entries).toHaveLength(50);
    expect(allTime.nextCursor).not.toBeNull();
    if (allTime.nextCursor === null) {
      throw new Error("All-time history should have another page");
    }
    const finalPage = await caller.consumerPlayer.matchHistory({
      playerId: player.id,
      games: "all",
      limit: 50,
      cursor: allTime.nextCursor,
    });
    expect(finalPage.entries).toHaveLength(5);
    expect(finalPage.entries.at(-1)?.queue).toBeNull();
  });
});
