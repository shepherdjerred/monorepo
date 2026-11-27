import { describe, expect, test, vi } from "vitest";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import type * as AccessModule from "#src/consumer/access.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import { rawArchiveReceiptRecord } from "#src/report-lake/durable-receipts.ts";
import {
  configureConsumerProfileFeatureTest,
  registerConsumerProfileFeatureTestLifecycle,
} from "#src/testing/consumer-profile-feature-test.ts";
import { resetFlagOverrides } from "#src/configuration/flags.ts";
import { countReportSlotsTaken } from "#src/reports/duckdb/instance.ts";
import type * as FixturesModule from "#src/testing/consumer-player-fixtures.ts";
import { seedConsumerPlayer } from "#src/testing/consumer-player-seed.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * The data behind the redesigned Player and Players pages:
 * `consumerPlayer.profileSummary` (highlights, plays with, champion form) and
 * `consumerPlayer.roster`. Both are one lake slot per call.
 */

// The roster's live status reads each captured game's roster from its archived
// spectator snapshot; the object store is not part of this suite.
const archivedSnapshots = vi.hoisted(() => new Map<string, object>());
vi.mock("#src/report-lake/receipted-archive.ts", async () => {
  const { stubArchivedPrematchSnapshots } = await vi.importActual<
    typeof FixturesModule
  >("#src/testing/consumer-player-fixtures.ts");
  return await stubArchivedPrematchSnapshots(archivedSnapshots);
});

// Discord membership is the one boundary the harness cannot make unavailable.
// One named actor gets that answer; nothing is shared between tests, so a test
// that outlives its timeout cannot change what the next one sees.
const UNAVAILABLE_ACTOR = vi.hoisted(() => "300000000000000059");
vi.mock("#src/consumer/access.ts", async () => {
  const actual: typeof AccessModule = await vi.importActual(
    "#src/consumer/access.ts",
  );
  return {
    ...actual,
    resolveConsumerGuildAccess: (
      ...args: Parameters<typeof actual.resolveConsumerGuildAccess>
    ) =>
      args[0].discordId === UNAVAILABLE_ACTOR
        ? Promise.resolve({ kind: "unavailable" as const })
        : actual.resolveConsumerGuildAccess(...args),
  };
});

const guildId = DiscordGuildIdSchema.parse("100000000000000051");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000052");
const foreignGuildId = DiscordGuildIdSchema.parse("100000000000000053");
const profileFeature = configureConsumerProfileFeatureTest([
  guildId,
  otherGuildId,
  foreignGuildId,
]);

const trpc = await createOfflineTrpcHarness("trpc-consumer-player-pages-test");
const { prisma: testPrisma } = trpc;
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000051");
const friendDiscordId = DiscordAccountIdSchema.parse("300000000000000052");
const { lakeDir } = profileFeature;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

registerConsumerProfileFeatureTestLifecycle({
  feature: profileFeature,
  prepare: async () => {
    archivedSnapshots.clear();
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await testPrisma.currentRankSnapshot.deleteMany();
    await testPrisma.matchRankHistory.deleteMany();
    await testPrisma.matchProcessingReceipt.deleteMany();
    await testPrisma.account.deleteMany();
    await testPrisma.player.deleteMany();
    await profileFeature.resetLake();
  },
  cleanup: async () => {
    resetFlagOverrides("scout-consumer-player-profiles-enabled");
    await testPrisma.$disconnect();
  },
});

function seedPlayer(options: Parameters<typeof seedConsumerPlayer>[2]) {
  return seedConsumerPlayer(testPrisma, actorDiscordId, options);
}

let matchCounter = 0;
function nextMatchId(): RiotMatchId {
  matchCounter += 1;
  return RiotMatchIdSchema.parse(
    `NA1_${(9_500_000_000 + matchCounter).toString()}`,
  );
}

function game(options: {
  player: { id: number; alias: string };
  puuid: LeaguePuuid;
  win: boolean;
  at: Date;
  championId?: number;
  championName?: string;
  queue?: string;
  matchId?: RiotMatchId;
  largestMultiKill?: number;
}): TestLakeMatchFact {
  return {
    playerId: options.player.id,
    playerAlias: options.player.alias,
    matchId: options.matchId ?? nextMatchId(),
    puuid: options.puuid,
    queue: options.queue ?? "solo",
    win: options.win,
    surrendered: false,
    kills: 5,
    deaths: 2,
    assists: 7,
    championId: options.championId ?? 103,
    championName: options.championName ?? "Ahri",
    gameCreationAt: options.at,
    ...(options.largestMultiKill === undefined
      ? {}
      : { largestMultiKill: options.largestMultiKill }),
  };
}

/** A standard 5v5: the tracked players on one team, strangers everywhere else. */
function fiveVsFive(options: {
  at: Date;
  win: boolean;
  together: { player: { id: number; alias: string }; puuid: LeaguePuuid }[];
}) {
  const matchId = nextMatchId();
  const tracked = options.together.map(({ player, puuid }) =>
    game({ player, puuid, win: options.win, at: options.at, matchId }),
  );
  const strangers = Array.from(
    { length: 10 - tracked.length },
    (_, index): TestLakeMatchFact => {
      const onOurTeam = index < 5 - tracked.length;
      return {
        playerId: 9000 + index,
        playerAlias: `Stranger ${index.toString()}`,
        matchId,
        puuid: testPuuid(`stranger-${matchId}-${index.toString()}`),
        queue: "solo",
        win: onOurTeam ? options.win : !options.win,
        surrendered: false,
        kills: 3,
        deaths: 3,
        assists: 3,
        teamId: onOurTeam ? 100 : 200,
        gameCreationAt: options.at,
      };
    },
  );
  return { tracked, strangers };
}

function enableProfiles(...guildIds: DiscordGuildId[]): void {
  profileFeature.enable(...guildIds);
}

function rankJson(tier: string, division: number, lp: number) {
  return JSON.stringify({ tier, division, lp, wins: 30, losses: 20 });
}

describe("page endpoints: access", () => {
  // Neither answer reaches the lake, so these never wait on DuckDB.
  test.each(["profileSummary", "roster"] as const)(
    "%s is forbidden when no shared server has the feature",
    async (procedure) => {
      const call = () =>
        procedure === "roster"
          ? trpc.authedCaller().consumerPlayer.roster()
          : trpc.authedCaller().consumerPlayer.profileSummary({ playerId: 1 });
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  test.each(["profileSummary", "roster"] as const)(
    "%s is unavailable, not forbidden, when Discord cannot be asked",
    async (procedure) => {
      enableProfiles(guildId);
      const caller = trpc.authedCaller(
        DiscordAccountIdSchema.parse(UNAVAILABLE_ACTOR),
      );
      const call = () =>
        procedure === "roster"
          ? caller.consumerPlayer.roster()
          : caller.consumerPlayer.profileSummary({ playerId: 1 });
      await expect(call()).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
    },
  );

  test("a player in a server the viewer does not share is not found", async () => {
    enableProfiles(guildId, foreignGuildId);
    const hidden = await seedPlayer({
      serverId: foreignGuildId,
      alias: "Hidden Player",
      puuids: [testPuuid("hidden-main")],
    });
    await expect(
      trpc
        .authedCaller()
        .consumerPlayer.profileSummary({ playerId: hidden.id }),
    ).rejects.toThrow("Player was not found");
  });
});

describe("consumerPlayer.profileSummary highlights", () => {
  test("reports the streak, last results, best champion, latest game and champion form", async () => {
    enableProfiles(guildId);
    const main = testPuuid("highlights-main");
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Highlights",
      puuids: [main],
    });
    const now = Date.now();
    // Newest first: W W L W L W, on Ahri, Ahri, Syndra, Ahri, Syndra, Ahri.
    const history: [boolean, string, number][] = [
      [true, "Ahri", 103],
      [true, "Ahri", 103],
      [false, "Syndra", 134],
      [true, "Ahri", 103],
      [false, "Syndra", 134],
      [true, "Ahri", 103],
    ];
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: history.map(([win, championName, championId], index) =>
        game({
          player,
          puuid: main,
          win,
          championName,
          championId,
          at: new Date(now - (index + 1) * HOUR_MS),
          // The newest game was a quadra kill.
          ...(index === 0 ? { largestMultiKill: 4 } : {}),
        }),
      ),
    });

    const summary = await trpc
      .authedCaller()
      .consumerPlayer.profileSummary({ playerId: player.id });

    expect(summary.highlights.streak).toEqual({
      result: "win",
      games: 2,
      atLeast: false,
    });
    expect(summary.highlights.lately?.games).toBe(6);
    expect(summary.highlights.lately?.wins).toBe(4);
    expect(summary.highlights.lately?.results.map((r) => r.win)).toEqual([
      true,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(summary.highlights.bestChampion).toMatchObject({
      championName: "Ahri",
      games: 4,
      wins: 4,
      winRate: 1,
      lowSample: true,
    });
    expect(summary.highlights.latestGame).toMatchObject({
      win: true,
      championName: "Ahri",
      kills: 5,
      deaths: 2,
      assists: 7,
      largestMultiKill: 4,
      queue: "solo",
      leaguePointsDelta: null,
    });
    expect(summary.championForm).toEqual([
      {
        championId: 103,
        championName: "Ahri",
        games: 4,
        wins: 4,
        results: ["win", "win", "win", "win"],
      },
      {
        championId: 134,
        championName: "Syndra",
        games: 2,
        wins: 0,
        results: ["loss", "loss"],
      },
    ]);
  });

  test("champion form covers each champion's last 10 games beyond the window", async () => {
    enableProfiles(guildId);
    const main = testPuuid("form-main");
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Form",
      puuids: [main],
    });
    const now = Date.now();
    // 12 Ahri games, newest 10 all wins and the two oldest losses.
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: Array.from({ length: 12 }, (_, index) =>
        game({
          player,
          puuid: main,
          win: index < 10,
          at: new Date(now - (index + 1) * HOUR_MS),
        }),
      ),
    });

    const summary = await trpc
      .authedCaller()
      .consumerPlayer.profileSummary({ playerId: player.id, games: 20 });
    expect(summary.championForm[0]).toMatchObject({
      championName: "Ahri",
      games: 10,
      wins: 10,
    });
    expect(summary.championPool[0]?.games).toBe(12);
  });
});

describe("consumerPlayer.profileSummary plays with", () => {
  test("lists the friends this player queues with, with games and wins together", async () => {
    enableProfiles(guildId, otherGuildId);
    const main = testPuuid("plays-main");
    const riverPuuid = testPuuid("plays-river");
    const tidalPuuid = testPuuid("plays-tidal");
    const otherGuildPuuid = testPuuid("plays-other-guild");
    const subject = await seedPlayer({
      serverId: guildId,
      alias: "Subject",
      puuids: [main],
    });
    const river = await seedPlayer({
      serverId: guildId,
      alias: "RiverQuartz",
      puuids: [riverPuuid],
    });
    const tidal = await seedPlayer({
      serverId: guildId,
      alias: "TidalWren",
      puuids: [tidalPuuid],
    });
    const elsewhere = await seedPlayer({
      serverId: otherGuildId,
      alias: "Elsewhere",
      puuids: [otherGuildPuuid],
    });
    const now = Date.now();
    const games = [
      // RiverQuartz: 4 games together, 3 won.
      ...[true, true, true, false].map((win, index) =>
        fiveVsFive({
          at: new Date(now - (index + 1) * DAY_MS),
          win,
          together: [
            { player: subject, puuid: main },
            { player: river, puuid: riverPuuid },
          ],
        }),
      ),
      // TidalWren: two games, below the threshold for a friend.
      ...[true, false].map((win, index) =>
        fiveVsFive({
          at: new Date(now - (index + 6) * DAY_MS),
          win,
          together: [
            { player: subject, puuid: main },
            { player: tidal, puuid: tidalPuuid },
          ],
        }),
      ),
      // Three games with a player of another server: not a friend here.
      ...[true, true, true].map((win, index) =>
        fiveVsFive({
          at: new Date(now - (index + 9) * DAY_MS),
          win,
          together: [
            { player: subject, puuid: main },
            { player: elsewhere, puuid: otherGuildPuuid },
          ],
        }),
      ),
    ];
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: games.flatMap((entry) => entry.tracked),
      untrackedMatchFacts: games.flatMap((entry) => entry.strangers),
    });

    const summary = await trpc
      .authedCaller()
      .consumerPlayer.profileSummary({ playerId: subject.id });

    expect(summary.playsWith.windowDays).toBe(90);
    expect(summary.playsWith.friends).toEqual([
      {
        playerId: river.id,
        alias: "RiverQuartz",
        games: 4,
        wins: 3,
        lastGameMs: expect.any(Number),
      },
    ]);
  });

  test("an account with no games reports empty highlights, not an error", async () => {
    enableProfiles(guildId);
    const withAccount = await seedPlayer({
      serverId: guildId,
      alias: "No Games",
      puuids: [testPuuid("empty-main")],
    });
    const withoutAccount = await seedPlayer({
      serverId: guildId,
      alias: "No Accounts",
      puuids: [],
    });
    for (const player of [withAccount, withoutAccount]) {
      const summary = await trpc
        .authedCaller()
        .consumerPlayer.profileSummary({ playerId: player.id });
      expect(summary.highlights).toEqual({
        streak: null,
        lately: null,
        bestChampion: null,
        latestGame: null,
      });
      expect(summary.championForm).toEqual([]);
      expect(summary.playsWith).toEqual({ windowDays: 90, friends: [] });
    }
  });

  test("takes one lake slot for the whole call", async () => {
    enableProfiles(guildId);
    const main = testPuuid("slot-main");
    const friend = testPuuid("slot-friend");
    const subject = await seedPlayer({
      serverId: guildId,
      alias: "Slot Subject",
      puuids: [main],
    });
    const buddy = await seedPlayer({
      serverId: guildId,
      alias: "Slot Friend",
      puuids: [friend],
    });
    const entries = [1, 2, 3].map((day) =>
      fiveVsFive({
        at: new Date(Date.now() - day * DAY_MS),
        win: true,
        together: [
          { player: subject, puuid: main },
          { player: buddy, puuid: friend },
        ],
      }),
    );
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: entries.flatMap((entry) => entry.tracked),
      untrackedMatchFacts: entries.flatMap((entry) => entry.strangers),
    });

    const before = countReportSlotsTaken();
    const summary = await trpc
      .authedCaller()
      .consumerPlayer.profileSummary({ playerId: subject.id });
    expect(countReportSlotsTaken() - before).toBe(1);
    expect(summary.playsWith.friends).toHaveLength(1);
  });
});

describe("consumerPlayer.roster", () => {
  test("counts a multi-account player once, with games merged across accounts", async () => {
    enableProfiles(guildId);
    const first = testPuuid("roster-multi-a");
    const second = testPuuid("roster-multi-b");
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Two Accounts",
      puuids: [first, second],
    });
    const now = Date.now();
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        game({
          player,
          puuid: first,
          win: true,
          at: new Date(now - 2 * HOUR_MS),
        }),
        game({
          player,
          puuid: second,
          win: false,
          at: new Date(now - HOUR_MS),
          championId: 40,
          championName: "Janna",
        }),
        game({
          player,
          puuid: first,
          win: true,
          at: new Date(now - 20 * DAY_MS),
        }),
      ],
    });
    // The older rank on one account, the fresher one on the other.
    await testPrisma.currentRankSnapshot.createMany({
      data: [
        {
          puuid: first,
          soloRank: rankJson("gold", 2, 10),
          fetchedAt: new Date(now - 3 * DAY_MS),
        },
        {
          puuid: second,
          soloRank: rankJson("emerald", 4, 55),
          flexRank: rankJson("silver", 1, 20),
          fetchedAt: new Date(now - DAY_MS),
        },
      ],
    });

    const roster = await trpc.authedCaller().consumerPlayer.roster();

    expect(roster.players).toHaveLength(1);
    const entry = roster.players[0];
    expect(entry).toMatchObject({
      playerId: player.id,
      alias: "Two Accounts",
      accountCount: 2,
      isYou: false,
      lastSevenDays: { games: 2 },
      form: { games: 3, wins: 2, streak: { result: "loss", games: 1 } },
      latestGame: { win: false, championName: "Janna" },
    });
    expect(entry?.rank.solo).toMatchObject({ tier: "emerald", division: 4 });
    expect(entry?.rank.flex).toMatchObject({ tier: "silver" });
  });

  test("counts a player tracked in two servers once, under both servers", async () => {
    enableProfiles(guildId, otherGuildId);
    const mainPuuid = testPuuid("roster-multi-server-main");
    const altPuuid = testPuuid("roster-multi-server-alt");
    const inFirst = await seedPlayer({
      serverId: guildId,
      alias: "Travelling",
      discordId: friendDiscordId,
      puuids: [mainPuuid],
    });
    const inSecond = await seedPlayer({
      serverId: otherGuildId,
      alias: "Travelling Alias",
      discordId: friendDiscordId,
      puuids: [altPuuid],
    });
    // The same Riot account under a different Discord link still joins them.
    const sharedPuuid = testPuuid("roster-shared-puuid");
    const sharedFirst = await seedPlayer({
      serverId: guildId,
      alias: "Shared One",
      puuids: [sharedPuuid],
    });
    await seedPlayer({
      serverId: otherGuildId,
      alias: "Shared Two",
      puuids: [sharedPuuid],
    });
    const now = Date.now();
    await writeTestLake(lakeDir, {
      serverId: guildId,
      alsoTrackedBy: [otherGuildId],
      matchFacts: [
        game({
          player: inFirst,
          puuid: mainPuuid,
          win: true,
          at: new Date(now - HOUR_MS),
        }),
        game({
          player: inSecond,
          puuid: altPuuid,
          win: true,
          at: new Date(now - 2 * HOUR_MS),
        }),
        game({
          player: sharedFirst,
          puuid: sharedPuuid,
          win: false,
          at: new Date(now - 3 * HOUR_MS),
        }),
      ],
    });

    const roster = await trpc.authedCaller().consumerPlayer.roster();

    expect(roster.guilds.map((guild) => guild.id)).toEqual([
      guildId,
      otherGuildId,
    ]);
    expect(roster.players).toHaveLength(2);
    const travelling = roster.players.find((p) => p.alias === "Travelling");
    expect(travelling?.memberships.map((m) => m.guild.id)).toEqual([
      guildId,
      otherGuildId,
    ]);
    expect(travelling?.memberships.map((m) => m.playerId)).toEqual([
      inFirst.id,
      inSecond.id,
    ]);
    expect(travelling?.accountCount).toBe(2);
    expect(travelling?.lastSevenDays.games).toBe(2);
    const shared = roster.players.find((p) => p.alias === "Shared One");
    expect(shared?.memberships).toHaveLength(2);
    expect(shared?.accountCount).toBe(1);
    expect(shared?.lastSevenDays.games).toBe(1);
    expect(JSON.stringify(roster)).not.toContain(friendDiscordId);
  });

  test("shows only the servers the viewer shares, and flags the viewer", async () => {
    enableProfiles(guildId, foreignGuildId);
    await seedPlayer({
      serverId: guildId,
      alias: "Me",
      discordId: actorDiscordId,
      puuids: [testPuuid("roster-me")],
    });
    await seedPlayer({
      serverId: foreignGuildId,
      alias: "Not Visible",
      puuids: [testPuuid("roster-foreign")],
    });

    const roster = await trpc
      .authedCaller(actorDiscordId)
      .consumerPlayer.roster();
    expect(roster.guilds.map((guild) => guild.id)).toEqual([guildId]);
    expect(roster.players.map((p) => [p.alias, p.isYou])).toEqual([
      ["Me", true],
    ]);
  });
});

describe("consumerPlayer.roster ordering", () => {
  test("orders by Solo/Duo rank, then latest game, then name, and never shifts", async () => {
    enableProfiles(guildId, otherGuildId);
    const now = Date.now();
    const seeded = [
      { alias: "Zed Unranked Old", rank: null, ageHours: 48 },
      { alias: "Beta Unranked", rank: null, ageHours: 1 },
      { alias: "Alpha Unranked", rank: null, ageHours: 1 },
      { alias: "Emerald One", rank: rankJson("emerald", 1, 22), ageHours: 30 },
      { alias: "Platinum One", rank: rankJson("platinum", 1, 80), ageHours: 2 },
      { alias: "Platinum Two", rank: rankJson("platinum", 2, 45), ageHours: 5 },
    ];
    const facts: TestLakeMatchFact[] = [];
    for (const [index, entry] of seeded.entries()) {
      const puuid = testPuuid(`roster-order-${index.toString()}`);
      const player = await seedPlayer({
        serverId: index % 2 === 0 ? guildId : otherGuildId,
        alias: entry.alias,
        puuids: [puuid],
      });
      facts.push(
        game({
          player,
          puuid,
          win: true,
          at: new Date(now - entry.ageHours * HOUR_MS),
        }),
      );
      if (entry.rank !== null) {
        await testPrisma.currentRankSnapshot.create({
          data: { puuid, soloRank: entry.rank, fetchedAt: new Date(now) },
        });
      }
    }
    await writeTestLake(lakeDir, {
      serverId: guildId,
      alsoTrackedBy: [otherGuildId],
      matchFacts: facts,
    });

    const first = await trpc.authedCaller().consumerPlayer.roster();
    const second = await trpc.authedCaller().consumerPlayer.roster();

    expect(first.players.map((p) => p.alias)).toEqual([
      "Emerald One",
      "Platinum One",
      "Platinum Two",
      "Alpha Unranked",
      "Beta Unranked",
      "Zed Unranked Old",
    ]);
    expect(second.players.map((p) => p.playerId)).toEqual(
      first.players.map((p) => p.playerId),
    );
  });

  test("breaks a full tie by player id", async () => {
    enableProfiles(guildId, otherGuildId);
    const one = await seedPlayer({
      serverId: guildId,
      alias: "Twin",
      puuids: [testPuuid("roster-twin-a")],
    });
    const two = await seedPlayer({
      serverId: otherGuildId,
      alias: "Twin",
      puuids: [testPuuid("roster-twin-b")],
    });
    const roster = await trpc.authedCaller().consumerPlayer.roster();
    expect(roster.players.map((p) => p.playerId)).toEqual([one.id, two.id]);
  });
});

describe("consumerPlayer.roster facts", () => {
  test("a player with no history has empty facts", async () => {
    enableProfiles(guildId);
    const bare = await seedPlayer({
      serverId: guildId,
      alias: "Bare",
      puuids: [],
    });
    await seedPlayer({
      serverId: guildId,
      alias: "Quiet",
      puuids: [testPuuid("roster-quiet")],
    });
    const roster = await trpc.authedCaller().consumerPlayer.roster();
    expect(roster.players).toHaveLength(2);
    for (const entry of roster.players) {
      expect(entry).toMatchObject({
        accountCount: entry.playerId === bare.id ? 0 : 1,
        rank: { solo: null, flex: null },
        latestGame: null,
        live: null,
        lastSevenDays: { games: 0 },
        form: null,
      });
    }
  });

  test("counts the last seven days and carries live status for a captured game", async () => {
    enableProfiles(guildId);
    const main = testPuuid("roster-live-main");
    const finished = testPuuid("roster-live-finished");
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Live Player",
      puuids: [main],
    });
    const other = await seedPlayer({
      serverId: guildId,
      alias: "Finished Player",
      puuids: [finished],
    });
    const now = Date.now();
    const liveMatchId = RiotMatchIdSchema.parse("NA1_8801");
    const finishedMatchId = RiotMatchIdSchema.parse("NA1_8802");
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        game({ player, puuid: main, win: true, at: new Date(now - DAY_MS) }),
        game({
          player,
          puuid: main,
          win: true,
          at: new Date(now - 3 * DAY_MS),
        }),
        game({
          player,
          puuid: main,
          win: false,
          at: new Date(now - 10 * DAY_MS),
        }),
        // The lake already holds this captured game: it is over.
        game({
          player: other,
          puuid: finished,
          win: true,
          at: new Date(now - 5 * 60_000),
          matchId: finishedMatchId,
        }),
      ],
    });
    for (const [matchId, key] of [
      [liveMatchId, "live"],
      [finishedMatchId, "finished"],
    ] as const) {
      await recordReceipt(
        testPrisma,
        rawArchiveReceiptRecord({
          matchId,
          artifact: ArtifactDescriptorSchema.parse({
            kind: "prematch",
            key: `prematch/2026/09/20/${key}/spectator-data.json`,
            digest: "f".repeat(64),
            bytes: 4096,
            contentType: "application/json",
            capturedAt: new Date(now - 60_000).toISOString(),
          }),
        }),
      );
    }
    archivedSnapshots.set(liveMatchId, {
      gameId: 8801,
      gameQueueConfigId: 420,
      participants: [
        { puuid: main, championId: 103 },
        { puuid: null, championId: 1 },
      ],
    });
    archivedSnapshots.set(finishedMatchId, {
      gameId: 8802,
      gameQueueConfigId: 420,
      participants: [{ puuid: finished, championId: 64 }],
    });

    const before = countReportSlotsTaken();
    const roster = await trpc.authedCaller().consumerPlayer.roster();
    expect(countReportSlotsTaken() - before).toBe(1);

    const live = roster.players.find((p) => p.alias === "Live Player");
    expect(live?.lastSevenDays.games).toBe(2);
    expect(live?.live).toMatchObject({
      gameId: "8801",
      queueId: 420,
      championId: 103,
    });
    expect(
      roster.players.find((p) => p.alias === "Finished Player")?.live,
    ).toBe(null);
  });

  test("ranks come from the newest evidence: a later snapshot over an older game", async () => {
    enableProfiles(guildId);
    const main = testPuuid("roster-rank-main");
    const player = await seedPlayer({
      serverId: guildId,
      alias: "Climber",
      puuids: [main],
    });
    const now = Date.now();
    const matchId = nextMatchId();
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        game({
          player,
          puuid: main,
          win: true,
          at: new Date(now - 3 * DAY_MS),
          matchId,
        }),
      ],
    });
    await testPrisma.matchRankHistory.create({
      data: {
        matchId,
        puuid: main,
        queueType: "solo",
        rankAfter: rankJson("gold", 1, 90),
        matchGameEndAt: new Date(now - 3 * DAY_MS),
        capturedAt: new Date(now - 3 * DAY_MS),
      },
    });
    await testPrisma.currentRankSnapshot.create({
      data: {
        puuid: main,
        soloRank: rankJson("platinum", 4, 5),
        fetchedAt: new Date(now - DAY_MS),
      },
    });
    const roster = await trpc.authedCaller().consumerPlayer.roster();
    expect(roster.players[0]?.rank.solo).toMatchObject({
      tier: "platinum",
      division: 4,
      lp: 5,
    });
  });
});
