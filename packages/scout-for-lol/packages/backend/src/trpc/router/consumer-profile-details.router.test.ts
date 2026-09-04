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

const guildOne = DiscordGuildIdSchema.parse("100000000000000061");
const guildTwo = DiscordGuildIdSchema.parse("100000000000000062");
const profileFeature = configureConsumerProfileFeatureTest([
  guildOne,
  guildTwo,
]);

const trpc = await createOfflineTrpcHarness("consumer-profile-details-test");
const actor = DiscordAccountIdSchema.parse("300000000000000061");
const { lakeDir } = profileFeature;
const created = new Date("2026-08-25T12:00:00.000Z");

async function player(options: {
  guildId: DiscordGuildId;
  alias: string;
  puuid: LeaguePuuid;
  discordId?: DiscordAccountId;
}) {
  const row = await trpc.prisma.player.create({
    data: {
      serverId: options.guildId,
      alias: options.alias,
      creatorDiscordId: actor,
      ...(options.discordId === undefined
        ? {}
        : { discordId: options.discordId }),
      createdTime: created,
      updatedTime: created,
    },
  });
  await trpc.prisma.account.create({
    data: {
      serverId: options.guildId,
      playerId: row.id,
      alias: `${options.alias} account`,
      puuid: options.puuid,
      region: "AMERICA_NORTH",
      creatorDiscordId: actor,
      riotGameName: options.alias,
      riotTagLine: "NA1",
      createdTime: created,
      updatedTime: created,
    },
  });
  return row;
}

function fact(options: {
  playerId: number;
  alias: string;
  puuid: string;
  matchId: string;
  win: boolean;
  championId?: number;
  championName?: string;
  teamId?: number;
  index?: number;
}) {
  return {
    playerId: options.playerId,
    playerAlias: options.alias,
    puuid: options.puuid,
    matchId: options.matchId,
    queue: "solo",
    win: options.win,
    surrendered: false,
    kills: options.win ? 8 : 2,
    deaths: options.win ? 2 : 6,
    assists: 6,
    championId: options.championId ?? 22,
    championName: options.championName ?? "Ashe",
    teamId: options.teamId ?? 100,
    gameCreationAt: new Date(created.getTime() - (options.index ?? 0) * 60_000),
  };
}

registerConsumerProfileFeatureTestLifecycle({
  feature: profileFeature,
  prepare: async () => {
    profileFeature.enable(guildOne, guildTwo);
    trpc.setMembership([
      { guildId: guildOne, asAdmin: false },
      { guildId: guildTwo, asAdmin: false },
    ]);
    await trpc.prisma.account.deleteMany();
    await trpc.prisma.player.deleteMany();
    await profileFeature.resetLake();
  },
  cleanup: async () => {
    await trpc.prisma.$disconnect();
  },
});

describe("consumerChampion.compare", () => {
  test("separates qualifying samples, keeps guild registrations distinct, and marks the viewer without an ID", async () => {
    const onePuuid = testPuuid("champion-one");
    const twoPuuid = testPuuid("champion-two");
    const smallPuuid = testPuuid("champion-small");
    const one = await player({
      guildId: guildOne,
      alias: "Shared Alias",
      puuid: onePuuid,
      discordId: actor,
    });
    const two = await player({
      guildId: guildTwo,
      alias: "Shared Alias",
      puuid: twoPuuid,
    });
    const small = await player({
      guildId: guildOne,
      alias: "Small Sample",
      puuid: smallPuuid,
    });
    const matches = [
      ...Array.from({ length: 10 }, (_, index) =>
        fact({
          playerId: one.id,
          alias: one.alias,
          puuid: onePuuid,
          matchId: `NA1_champion_one_${index.toString()}`,
          win: index < 7,
          index,
        }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        fact({
          playerId: two.id,
          alias: two.alias,
          puuid: twoPuuid,
          matchId: `NA1_champion_two_${index.toString()}`,
          win: index < 6,
          index,
        }),
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        fact({
          playerId: small.id,
          alias: small.alias,
          puuid: smallPuuid,
          matchId: `NA1_champion_small_${index.toString()}`,
          win: true,
          index,
        }),
      ),
    ];
    await writeTestLake(lakeDir, { serverId: guildOne, matchFacts: matches });

    const caller = trpc.authedCaller(actor);
    const qualified = await caller.consumerChampion.compare({
      championId: 22,
      games: "all",
      cohort: "qualified",
      sort: "win_rate",
    });
    expect(qualified.rows.map((row) => row.playerId)).toEqual([one.id, two.id]);
    expect(qualified.rows.map((row) => row.guild.guildId)).toEqual([
      guildOne,
      guildTwo,
    ]);
    expect(qualified.rows[0]?.viewerLinked).toBe(true);
    expect(JSON.stringify(qualified.rows)).not.toContain(actor);

    const lowSample = await caller.consumerChampion.compare({
      championId: 22,
      cohort: "small_sample",
    });
    expect(lowSample.rows.map((row) => row.playerId)).toEqual([small.id]);
  });

  test("rejects a guild outside the freshly authorized subset", async () => {
    await expect(
      trpc.authedCaller().consumerChampion.compare({
        championId: 22,
        guildIds: [DiscordGuildIdSchema.parse("100000000000000099")],
      }),
    ).rejects.toThrow(/outside/i);
  });

  test("paginates comparison results at 25 rows with a stable server cursor", async () => {
    const players = await Promise.all(
      Array.from({ length: 26 }, async (_, index) => {
        const puuid = testPuuid(`champion-page-${index.toString()}`);
        const entry = await player({
          guildId: guildOne,
          alias: `Player ${index.toString().padStart(2, "0")}`,
          puuid,
        });
        return { entry, puuid, index };
      }),
    );
    await writeTestLake(lakeDir, {
      serverId: guildOne,
      matchFacts: players.flatMap(({ entry, puuid, index }) =>
        Array.from({ length: 10 }, (_, gameIndex) =>
          fact({
            playerId: entry.id,
            alias: entry.alias,
            puuid,
            matchId: `NA1_page_${index.toString()}_${gameIndex.toString()}`,
            win: gameIndex < 5,
            index: gameIndex,
          }),
        ),
      ),
    });

    const caller = trpc.authedCaller(actor);
    const first = await caller.consumerChampion.compare({
      championId: 22,
      games: "all",
      cohort: "qualified",
      sort: "win_rate",
    });
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0]?.alias).toBe("Player 00");
    expect(first.nextCursor).toEqual({ offset: 25 });
    if (first.nextCursor === null) {
      throw new Error("The first comparison page must have a cursor");
    }
    const second = await caller.consumerChampion.compare({
      championId: 22,
      games: "all",
      cohort: "qualified",
      sort: "win_rate",
      cursor: first.nextCursor,
    });
    expect(second.rows.map((row) => row.alias)).toEqual(["Player 25"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("consumerMatch", () => {
  test("authorizes through the launching player and returns a full scoreboard with scoped aliases", async () => {
    const launchPuuid = testPuuid("match-launch");
    const teammatePuuid = testPuuid("match-teammate");
    const launch = await player({
      guildId: guildOne,
      alias: "Launching Player",
      puuid: launchPuuid,
    });
    const teammate = await player({
      guildId: guildOne,
      alias: "Known Teammate",
      puuid: teammatePuuid,
    });
    await writeTestLake(lakeDir, {
      serverId: guildOne,
      matchFacts: [
        fact({
          playerId: launch.id,
          alias: launch.alias,
          puuid: launchPuuid,
          matchId: "NA1_detail",
          win: true,
        }),
        fact({
          playerId: teammate.id,
          alias: teammate.alias,
          puuid: teammatePuuid,
          matchId: "NA1_detail",
          win: false,
          championId: 86,
          championName: "Garen",
          teamId: 200,
        }),
      ],
    });

    const detail = await trpc.authedCaller().consumerMatch.detail({
      playerId: launch.id,
      matchId: "NA1_detail",
    });
    expect(detail.match.teams).toHaveLength(2);
    expect(detail.match.teams.flatMap((team) => team.participants)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selectedPlayer: true }),
        expect.objectContaining({
          scoutAliases: [
            expect.objectContaining({
              playerId: teammate.id,
              alias: "Known Teammate",
            }),
          ],
        }),
      ]),
    );
    expect(detail.timeline.coverage).toBeNull();
    expect(JSON.stringify(detail)).not.toContain(actor);
  });

  test("does not authorize a match the named player did not play", async () => {
    const launch = await player({
      guildId: guildOne,
      alias: "Launch",
      puuid: testPuuid("match-denied-launch"),
    });
    const other = await player({
      guildId: guildOne,
      alias: "Other",
      puuid: testPuuid("match-denied-other"),
    });
    await writeTestLake(lakeDir, {
      serverId: guildOne,
      matchFacts: [
        fact({
          playerId: other.id,
          alias: other.alias,
          puuid: testPuuid("match-denied-other"),
          matchId: "NA1_not_yours",
          win: true,
        }),
      ],
    });
    await expect(
      trpc.authedCaller().consumerMatch.detail({
        playerId: launch.id,
        matchId: "NA1_not_yours",
      }),
    ).rejects.toThrow("Match was not found");
  });
});
