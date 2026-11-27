import { describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import {
  clearConsumerProfileTables,
  configureConsumerProfileFeatureTest,
  expectOneLakeSlot,
  registerConsumerProfileFeatureTestLifecycle,
} from "#src/testing/consumer-profile-feature-test.ts";
import { resetFlagOverrides } from "#src/configuration/flags.ts";
import { seedConsumerPlayer } from "#src/testing/consumer-player-seed.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import {
  lobby,
  soloGame,
  type Seat,
} from "#src/trpc/router/consumer/compare/compare-test-lobbies.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";

/**
 * The data behind the Compare page: `consumerPlayer.compare`, one lake slot
 * per call.
 */

// One named actor's Discord membership cannot be asked.
const UNAVAILABLE_ACTOR = vi.hoisted(() => "300000000000000079");
vi.mock("#src/consumer/access.ts", async () => {
  const { withUnavailableMembershipFor } =
    await import("#src/testing/consumer-profile-feature-test.ts");
  return await withUnavailableMembershipFor(UNAVAILABLE_ACTOR);
});

const guildId = DiscordGuildIdSchema.parse("100000000000000071");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000072");
const foreignGuildId = DiscordGuildIdSchema.parse("100000000000000073");
const profileFeature = configureConsumerProfileFeatureTest([
  guildId,
  otherGuildId,
  foreignGuildId,
]);

const trpc = await createOfflineTrpcHarness("trpc-consumer-compare-test");
const { prisma: testPrisma } = trpc;
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000071");
const friendDiscordId = DiscordAccountIdSchema.parse("300000000000000072");
const { lakeDir } = profileFeature;

const HOUR_MS = 3_600_000;

registerConsumerProfileFeatureTestLifecycle({
  feature: profileFeature,
  prepare: async () => {
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await clearConsumerProfileTables(testPrisma);
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

function rankJson(tier: string, division: number, lp: number) {
  return JSON.stringify({ tier, division, lp, wins: 30, losses: 20 });
}

describe("consumerPlayer.compare access", () => {
  test("is forbidden when no shared server has the feature", async () => {
    await expect(
      trpc
        .authedCaller()
        .consumerPlayer.compare({ leftPlayerId: 1, rightPlayerId: 2 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("is unavailable, not forbidden, when Discord cannot be asked", async () => {
    profileFeature.enable(guildId);
    await expect(
      trpc
        .authedCaller(DiscordAccountIdSchema.parse(UNAVAILABLE_ACTOR))
        .consumerPlayer.compare({ leftPlayerId: 1, rightPlayerId: 2 }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  test("a player in a server the viewer does not share is not found", async () => {
    profileFeature.enable(guildId, foreignGuildId);
    const mine = await seedPlayer({
      serverId: guildId,
      alias: "Mine",
      puuids: [testPuuid("compare-access-mine")],
    });
    const hidden = await seedPlayer({
      serverId: foreignGuildId,
      alias: "Hidden",
      puuids: [testPuuid("compare-access-hidden")],
    });
    for (const [leftPlayerId, rightPlayerId] of [
      [mine.id, hidden.id],
      [hidden.id, mine.id],
    ] as const) {
      await expect(
        trpc
          .authedCaller()
          .consumerPlayer.compare({ leftPlayerId, rightPlayerId }),
      ).rejects.toThrow("Player was not found");
    }
  });

  test("a player compared with themselves, or with their other server's row, is rejected", async () => {
    profileFeature.enable(guildId, otherGuildId);
    const inFirst = await seedPlayer({
      serverId: guildId,
      alias: "Travelling",
      discordId: friendDiscordId,
      puuids: [testPuuid("compare-same-main")],
    });
    const inSecond = await seedPlayer({
      serverId: otherGuildId,
      alias: "Travelling Alias",
      discordId: friendDiscordId,
      puuids: [testPuuid("compare-same-alt")],
    });
    for (const [leftPlayerId, rightPlayerId] of [
      [inFirst.id, inFirst.id],
      [inFirst.id, inSecond.id],
    ] as const) {
      await expect(
        trpc
          .authedCaller()
          .consumerPlayer.compare({ leftPlayerId, rightPlayerId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});

describe("consumerPlayer.compare side by side", () => {
  test("puts rank, recent form, games together, games against and shared champions side by side", async () => {
    profileFeature.enable(guildId);
    const first = testPuuid("compare-me-a");
    const second = testPuuid("compare-me-b");
    const friendPuuid = testPuuid("compare-friend");
    const me = await seedPlayer({
      serverId: guildId,
      alias: "Northstar",
      discordId: actorDiscordId,
      puuids: [first, second],
    });
    const friend = await seedPlayer({
      serverId: guildId,
      alias: "RiverQuartz",
      puuids: [friendPuuid],
    });
    const now = Date.now();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR_MS);
    const northstar = (team: 100 | 200, extra: Partial<Seat> = {}): Seat => ({
      player: me,
      puuid: first,
      team,
      ...extra,
    });
    const river = (team: 100 | 200, extra: Partial<Seat> = {}): Seat => ({
      player: friend,
      puuid: friendPuuid,
      team,
      ...extra,
    });
    const jinx = { championId: 222, championName: "Jinx" };

    const lobbies = [
      // Together: won, won (on the second account, Jinx for Northstar), lost.
      lobby({ at: at(1), winner: 100, seats: [northstar(100), river(100)] }),
      lobby({
        at: at(2),
        winner: 100,
        seats: [northstar(100, { puuid: second, ...jinx }), river(100)],
      }),
      lobby({ at: at(3), winner: 200, seats: [northstar(100), river(100)] }),
      // Against: Northstar wins once, RiverQuartz twice.
      lobby({ at: at(4), winner: 100, seats: [northstar(100), river(200)] }),
      lobby({ at: at(5), winner: 200, seats: [northstar(100), river(200)] }),
      lobby({
        at: at(6),
        winner: 200,
        seats: [northstar(100), river(200, jinx)],
      }),
      // Not an ordinary queue: counted in neither the duo nor the champions.
      lobby({
        at: at(7),
        winner: 100,
        queue: "aram",
        seats: [northstar(100), river(100)],
      }),
    ];
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        ...lobbies.flatMap((entry) => entry.tracked),
        soloGame({
          seat: northstar(100),
          win: false,
          at: at(8),
          championId: 134,
          championName: "Syndra",
        }),
      ],
      untrackedMatchFacts: lobbies.flatMap((entry) => entry.strangers),
    });
    // The older rank on one account, the fresher one on the other.
    await testPrisma.currentRankSnapshot.createMany({
      data: [
        {
          puuid: first,
          soloRank: rankJson("gold", 2, 10),
          fetchedAt: new Date(now - 3 * 24 * HOUR_MS),
        },
        {
          puuid: second,
          soloRank: rankJson("emerald", 2, 64),
          fetchedAt: new Date(now - 24 * HOUR_MS),
        },
      ],
    });

    const compare = await expectOneLakeSlot(
      async () =>
        await trpc.authedCaller(actorDiscordId).consumerPlayer.compare({
          leftPlayerId: me.id,
          rightPlayerId: friend.id,
        }),
    );

    expect(compare.left).toMatchObject({
      playerId: me.id,
      alias: "Northstar",
      isYou: true,
      form: { games: 8, wins: 4 },
    });
    expect(compare.left.rank).toMatchObject({ tier: "emerald", division: 2 });
    expect(compare.right).toMatchObject({
      playerId: friend.id,
      alias: "RiverQuartz",
      isYou: false,
      rank: null,
      form: { games: 7, wins: 5 },
    });
    expect(compare.together).toMatchObject({ games: 3, wins: 2 });
    expect(compare.together.matches.map((match) => match.win)).toEqual([
      true,
      true,
      false,
    ]);
    expect(compare.against.map((match) => match.winner)).toEqual([
      "left",
      "right",
      "right",
    ]);
    expect(compare.champions).toEqual([
      {
        championId: 103,
        championName: "Ahri",
        left: { games: 5, wins: 2 },
        right: { games: 5, wins: 3 },
      },
      {
        championId: 222,
        championName: "Jinx",
        left: { games: 1, wins: 1 },
        right: { games: 1, wins: 1 },
      },
    ]);
  });
});

describe("consumerPlayer.compare people and empty states", () => {
  test("counts a player tracked in two servers once", async () => {
    profileFeature.enable(guildId, otherGuildId);
    const mePuuid = testPuuid("compare-multi-me");
    const mainPuuid = testPuuid("compare-multi-main");
    const altPuuid = testPuuid("compare-multi-alt");
    const me = await seedPlayer({
      serverId: guildId,
      alias: "Me",
      discordId: actorDiscordId,
      puuids: [mePuuid],
    });
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
    const now = Date.now();
    const mine: Seat = { player: me, puuid: mePuuid, team: 100 };
    const lobbies = [
      lobby({
        at: new Date(now - HOUR_MS),
        winner: 100,
        seats: [mine, { player: inFirst, puuid: mainPuuid, team: 100 }],
      }),
      lobby({
        at: new Date(now - 2 * HOUR_MS),
        winner: 100,
        seats: [mine, { player: inSecond, puuid: altPuuid, team: 100 }],
      }),
    ];
    await writeTestLake(lakeDir, {
      serverId: guildId,
      alsoTrackedBy: [otherGuildId],
      matchFacts: lobbies.flatMap((entry) => entry.tracked),
      untrackedMatchFacts: lobbies.flatMap((entry) => entry.strangers),
    });

    // Either server's row names the same person.
    for (const rightPlayerId of [inFirst.id, inSecond.id]) {
      const compare = await trpc
        .authedCaller(actorDiscordId)
        .consumerPlayer.compare({ leftPlayerId: me.id, rightPlayerId });
      expect(compare.right.playerId).toBe(rightPlayerId);
      expect(compare.right.form).toEqual({ games: 2, wins: 2 });
      expect(compare.together).toMatchObject({ games: 2, wins: 2 });
      expect(compare.champions).toEqual([
        {
          championId: 103,
          championName: "Ahri",
          left: { games: 2, wins: 2 },
          right: { games: 2, wins: 2 },
        },
      ]);
    }
  });

  test("states empty sections as empty lists, and orders ties by name", async () => {
    profileFeature.enable(guildId);
    const leftPuuid = testPuuid("compare-empty-left");
    const rightPuuid = testPuuid("compare-empty-right");
    const left = await seedPlayer({
      serverId: guildId,
      alias: "Left",
      puuids: [leftPuuid],
    });
    const right = await seedPlayer({
      serverId: guildId,
      alias: "Right",
      puuids: [rightPuuid],
    });
    const idle = await seedPlayer({
      serverId: guildId,
      alias: "Idle",
      puuids: [testPuuid("compare-empty-idle")],
    });
    const now = Date.now();
    const seats = (player: typeof left, puuid: LeaguePuuid): Seat => ({
      player,
      puuid,
      team: 100,
    });
    const games = (["Zed", "Ahri"] as const).flatMap((championName, index) =>
      [seats(left, leftPuuid), seats(right, rightPuuid)].map((seat) =>
        soloGame({
          seat,
          win: true,
          at: new Date(now - (index + 1) * HOUR_MS),
          championId: championName === "Zed" ? 238 : 103,
          championName,
        }),
      ),
    );
    await writeTestLake(lakeDir, { serverId: guildId, matchFacts: games });

    const call = async (rightPlayerId: number) =>
      await trpc
        .authedCaller()
        .consumerPlayer.compare({ leftPlayerId: left.id, rightPlayerId });
    const compare = await call(right.id);

    expect(compare.together).toEqual({ games: 0, wins: 0, matches: [] });
    expect(compare.against).toEqual([]);
    expect(compare.champions.map((champion) => champion.championName)).toEqual([
      "Ahri",
      "Zed",
    ]);
    expect(await call(right.id)).toEqual(compare);

    const withIdle = await call(idle.id);
    expect(withIdle.right).toMatchObject({ rank: null, form: null });
    expect(withIdle.champions).toEqual([]);
    expect(withIdle.against).toEqual([]);
  });
});
