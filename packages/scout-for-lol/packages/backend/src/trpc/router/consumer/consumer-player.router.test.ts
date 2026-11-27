import { describe, expect, test, vi } from "vitest";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import { rawArchiveReceiptRecord } from "#src/report-lake/durable-receipts.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import {
  configureConsumerProfileFeatureTest,
  registerConsumerProfileFeatureTestLifecycle,
} from "#src/testing/consumer-profile-feature-test.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { seedConsumerPlayer } from "#src/testing/consumer-player-seed.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";

// The live view reads each captured game's roster from its archived spectator
// snapshot; the object store is not part of this suite.
const archivedSnapshots = vi.hoisted(() => new Map<string, object>());
vi.mock("#src/report-lake/receipted-archive.ts", async () => {
  const actual: object = await vi.importActual(
    "#src/report-lake/receipted-archive.ts",
  );
  return {
    ...actual,
    readArchivedPrematchSnapshot: (
      _descriptor: unknown,
      matchId: RiotMatchId,
    ) => {
      const snapshot = archivedSnapshots.get(matchId);
      if (snapshot === undefined) {
        throw new Error(`No archived snapshot stubbed for ${matchId}`);
      }
      return Promise.resolve(snapshot);
    },
  };
});

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

const seedPlayer = (options: Parameters<typeof seedConsumerPlayer>[2]) =>
  seedConsumerPlayer(testPrisma, actorDiscordId, options);

function matchFact(options: {
  matchId: RiotMatchId;
  puuid: LeaguePuuid;
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

function enableChallenges(...guildIds: DiscordGuildId[]): void {
  for (const server of guildIds) {
    addFlagOverride("challenge_runs_enabled", true, { server });
  }
}

registerConsumerProfileFeatureTestLifecycle({
  feature: profileFeature,
  prepare: async () => {
    resetFlagOverrides("challenge_runs_enabled");
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await testPrisma.currentRankSnapshot.deleteMany();
    await testPrisma.matchRankHistory.deleteMany();
    await testPrisma.matchProcessingReceipt.deleteMany();
    await testPrisma.account.deleteMany();
    await testPrisma.player.deleteMany();
    await profileFeature.resetLake();
  },
  cleanup: async () => {
    resetFlagOverrides("challenge_runs_enabled");
    await testPrisma.$disconnect();
  },
});

describe("consumer guild community authorization", () => {
  test("scopes overview and recent game observations to the selected enabled guild", async () => {
    enableProfiles(guildId);
    const visible = await seedPlayer({
      serverId: guildId,
      alias: "Guild Player",
      puuids: [MAIN],
    });
    await seedPlayer({
      serverId: otherGuildId,
      alias: "Other Player",
      puuids: [OTHER],
    });
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    const overview = await trpc
      .authedCaller()
      .consumerGuild.overview({ guildId });
    expect(overview.players).toEqual([
      { id: visible.id, alias: "Guild Player" },
    ]);
    await expect(
      trpc.authedCaller().consumerGuild.overview({ guildId: otherGuildId }),
    ).rejects.toThrow("Guild was not found");
    // A game V2 captured a minute ago, with one player from each guild in it.
    const liveMatchId = RiotMatchIdSchema.parse("NA1_123");
    await recordReceipt(
      testPrisma,
      rawArchiveReceiptRecord({
        matchId: liveMatchId,
        artifact: ArtifactDescriptorSchema.parse({
          kind: "prematch",
          key: "prematch/2026/09/20/123/spectator-data.json",
          digest: "f".repeat(64),
          bytes: 4096,
          contentType: "application/json",
          capturedAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    );
    archivedSnapshots.set(liveMatchId, {
      gameId: 123,
      participants: [{ puuid: MAIN }, { puuid: OTHER }, { puuid: null }],
    });
    const live = await trpc.authedCaller().consumerGuild.live({ guildId });
    expect(live).toHaveLength(1);
    expect(live[0]?.gameId).toBe("123");
    expect(live[0]?.players).toEqual([
      { playerId: visible.id, alias: "Guild Player" },
    ]);
  });
});

describe("consumer player challenge runs", () => {
  test("uses the protected player id without exposing a guild id", async () => {
    enableProfiles(guildId);
    enableChallenges(guildId);
    const linked = await seedPlayer({
      serverId: guildId,
      alias: "Challenge Runner",
      discordId: actorDiscordId,
      puuids: [MAIN],
    });

    await expect(
      trpc
        .authedCaller()
        .challenge.profileRunsByPlayerId({ playerId: linked.id }),
    ).resolves.toEqual([]);
    await expect(
      trpc
        .anonCaller()
        .challenge.profileRunsByPlayerId({ playerId: linked.id }),
    ).rejects.toThrow();

    const hidden = await seedPlayer({
      serverId: otherGuildId,
      alias: "Hidden Challenge Runner",
      discordId: DiscordAccountIdSchema.parse("300000000000000099"),
      puuids: [OTHER],
    });
    await expect(
      trpc
        .authedCaller()
        .challenge.profileRunsByPlayerId({ playerId: hidden.id }),
    ).rejects.toThrow("Player was not found");
  });
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

    trpc.setMembership([
      {
        guildId: DiscordGuildIdSchema.parse("100000000000000099"),
        asAdmin: false,
      },
    ]);
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
  test("lobby lookup matches cached Riot IDs exactly within current guild access", async () => {
    enableProfiles(guildId);
    const visible = await seedPlayer({
      serverId: guildId,
      alias: "Visible",
      puuids: [MAIN],
    });
    await seedPlayer({
      serverId: otherGuildId,
      alias: "Hidden",
      puuids: [OTHER],
    });
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    const result = await trpc.authedCaller().consumerPlayer.multisearch({
      riotIds: "visible riot 0#na1\nHidden Riot 0#NA1\nMissing#NA1",
    });
    expect(result.rows[0]?.matches.map((match) => match.playerId)).toEqual([
      visible.id,
    ]);
    expect(result.rows[1]?.matches).toEqual([]);
    expect(result.rows[2]?.matches).toEqual([]);
    await expect(
      trpc
        .authedCaller()
        .consumerPlayer.multisearch({ riotIds: "not-a-riot-id" }),
    ).rejects.toThrow();
  });

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
    await expect(
      trpc.authedCaller().consumerPlayer.rankHistory({ playerId: hidden.id }),
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
    await expect(
      trpc.authedCaller().consumerPlayer.rankHistory({ playerId: player.id }),
    ).rejects.toThrow(/not available/i);
  });

  test("returns empty queue series when Scout has no rank snapshots", async () => {
    enableProfiles(guildId);
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Unranked",
      puuids: [MAIN],
    });
    const history = await trpc
      .authedCaller()
      .consumerPlayer.rankHistory({ playerId: player.id });
    expect(history.currentSplit.displayName.length).toBeGreaterThan(0);
    expect(history.queues.solo).toEqual({ series: [], previous: [] });
    expect(history.queues.flex).toEqual({ series: [], previous: [] });
    expect(history.queues["ranked 5s"]).toEqual({ series: [], previous: [] });
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
        matchFact({
          matchId: RiotMatchIdSchema.parse("NA1_9100000010"),
          puuid: MAIN,
          playerId: player.id,
        }),
        matchFact({
          matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
          puuid: ALT,
          playerId: player.id,
          queue: "flex",
        }),
      ],
    });
    await testPrisma.matchRankHistory.createMany({
      data: [
        {
          matchId: RiotMatchIdSchema.parse("NA1_9100000010"),
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
          matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
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
      "NA1_9100000000",
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
        matchId: RiotMatchIdSchema.parse(
          `NA1_81001${index.toString().padStart(2, "0")}`,
        ),
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

describe("consumer readers over partial Mayhem records", () => {
  // Beta, 2026-11-22: once the Scout Client's Mayhem games reached the lake as
  // end-of-game records (no lobby creation time, no participant numbers) and
  // history records (no time played, pings or objective kills), every
  // profile read failed parsing a NULL game_creation_ms.
  const MATE = testPuuid("consumer-mayhem-mate");
  const now = Date.now();
  const completeId = RiotMatchIdSchema.parse("NA1_7300000001");
  const endOfGameId = RiotMatchIdSchema.parse("NA1_7300000002");
  const historyId = RiotMatchIdSchema.parse("NA1_7300000003");

  function mayhemFacts(playerId: number) {
    const game = (options: {
      matchId: RiotMatchId;
      hoursAgo: number;
      coverage: "complete" | "end_of_game" | "history";
    }) =>
      [MAIN, MATE].map((puuid) => ({
        ...matchFact({
          matchId: options.matchId,
          puuid,
          playerId: puuid === MAIN ? playerId : playerId + 100,
          queue: "aram mayhem",
          gameCreationAt: new Date(now - options.hoursAgo * 3_600_000),
        }),
        playerAlias: puuid === MAIN ? "Mayhem Player" : "Mayhem Mate",
        queueId: 2400,
        gameMode: "ARAM",
        mapId: 12,
        teamPosition: "",
        gameDurationSeconds: 1200,
        creepScore: 60,
        championName: puuid === MAIN ? "Ashe" : "Annie",
        championId: puuid === MAIN ? 22 : 1,
        coverage: options.coverage,
      }));
    return [
      ...game({ matchId: completeId, hoursAgo: 3, coverage: "complete" }),
      ...game({ matchId: endOfGameId, hoursAgo: 2, coverage: "end_of_game" }),
      ...game({ matchId: historyId, hoursAgo: 1, coverage: "history" }),
    ];
  }

  async function seedMayhemPlayer() {
    enableProfiles(guildId);
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Mayhem Player",
      puuids: [MAIN],
    });
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: mayhemFacts(player.id),
    });
    return player;
  }

  test("the profile summary counts every recorded game and ignores unstated stats", async () => {
    const player = await seedMayhemPlayer();
    const summary = await trpc
      .authedCaller()
      .consumerPlayer.profileSummary({ playerId: player.id });

    expect(summary.recentForm?.games).toBe(3);
    expect(summary.behavior?.recent20?.games).toBe(3);
    expect(summary.behavior?.streak?.games).toBe(3);
    // No lane is stated in Mayhem: no preferred position is invented.
    expect(summary.recentForm?.preferredPositions).toEqual([]);
    const [ashe] = summary.championPool;
    expect(ashe?.games).toBe(3);
    // A history record states no time played; its game length stands in, so
    // three 20-minute games of 60 CS are 3 CS a minute, not a division by an
    // unknown.
    expect(ashe?.csPerMinute).toBe(3);
    expect(summary.recentForm?.averageCsPerMinute).toBe(3);
  });

  test("match history pages through every record newest first", async () => {
    const player = await seedMayhemPlayer();
    const caller = trpc.authedCaller();
    const seen: RiotMatchId[] = [];
    const created: number[] = [];
    let cursor: Parameters<
      typeof caller.consumerPlayer.matchHistory
    >[0]["cursor"];
    for (let page = 0; page < 4; page += 1) {
      const history = await caller.consumerPlayer.matchHistory({
        playerId: player.id,
        limit: 1,
        games: "all",
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...history.entries.map((entry) => entry.matchId));
      created.push(...history.entries.map((entry) => entry.gameCreationMs));
      if (history.nextCursor === null) break;
      cursor = history.nextCursor;
    }
    expect(seen).toEqual([historyId, endOfGameId, completeId]);
    // The end-of-game record states no lobby creation: it is placed at its
    // start, the instant the canonical record is partitioned by.
    expect(created[1]).toBe(now - 2 * 3_600_000);
  });

  test("a game window places an end-of-game record by its start", async () => {
    enableProfiles(guildId);
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Windowed Mayhem Player",
      puuids: [MAIN],
    });
    const older = Array.from({ length: 20 }, (_, index) => ({
      ...matchFact({
        matchId: RiotMatchIdSchema.parse(
          `NA1_74000000${index.toString().padStart(2, "0")}`,
        ),
        puuid: MAIN,
        playerId: player.id,
        gameCreationAt: new Date(now - (index + 2) * 3_600_000),
      }),
      championId: 1,
      championName: "Annie",
    }));
    const newest = {
      ...matchFact({
        matchId: endOfGameId,
        puuid: MAIN,
        playerId: player.id,
        gameCreationAt: new Date(now - 3_600_000),
      }),
      coverage: "end_of_game" as const,
    };
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [...older, newest],
    });
    const caller = trpc.authedCaller();

    const summary = await caller.consumerPlayer.profileSummary({
      playerId: player.id,
      games: 20,
    });
    expect(
      summary.championPool.map((entry) => [entry.championName, entry.games]),
    ).toEqual([
      ["Annie", 19],
      ["Ashe", 1],
    ]);

    const comparison = await caller.consumerChampion.compare({
      championId: 22,
      games: 20,
      cohort: "small_sample",
    });
    expect(comparison.rows.map((row) => [row.playerId, row.games])).toEqual([
      [player.id, 1],
    ]);
  });

  test("the guild overview reads the records' rosters inside a date window", async () => {
    const player = await seedMayhemPlayer();
    const overview = await trpc.authedCaller().consumerGuild.overview({
      guildId,
      windowDays: 30,
      queuePreset: "all",
    });
    expect(overview.insights.matchCount).toBe(3);
    const form = overview.insights.accountForms.find(
      (entry) => entry.playerId === player.id,
    );
    expect(form?.games).toBe(3);
    expect(form?.csPerMinute).toBe(3);
  });
});
