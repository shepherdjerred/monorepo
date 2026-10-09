import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import type {
  LakeMatchParticipantRow,
  LakeTimelineCoverage,
  LaneDeltaFrame,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { buildRoleMatchups } from "#src/trpc/router/consumer/consumer-match-role-matchups.ts";
import {
  configureConsumerProfileFeatureTest,
  registerConsumerProfileFeatureTestLifecycle,
} from "#src/testing/consumer-profile-feature-test.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { writeTestLake } from "#src/testing/test-report-lake.ts";
import { designAuditMatchFixtures } from "#src/database/design-audit-match-fixture.ts";

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
  puuid: LeaguePuuid;
  matchId: RiotMatchId;
  win: boolean;
  championId?: number;
  championName?: string;
  teamId?: number;
  queue?: string;
  queueId?: number;
  gameMode?: string;
  playerSubteamId?: number;
  index?: number;
}) {
  return {
    playerId: options.playerId,
    playerAlias: options.alias,
    puuid: options.puuid,
    matchId: options.matchId,
    queue: options.queue ?? "solo",
    ...(options.queueId === undefined ? {} : { queueId: options.queueId }),
    ...(options.gameMode === undefined ? {} : { gameMode: options.gameMode }),
    ...(options.playerSubteamId === undefined
      ? {}
      : { playerSubteamId: options.playerSubteamId }),
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

describe("consumerMatch.reviewTimeline", () => {
  test("returns every key event and slim frames only after player authorization", async () => {
    const puuid = testPuuid("review-timeline");
    const launch = await player({
      guildId: guildOne,
      alias: "Reviewer",
      puuid,
    });
    const review = designAuditMatchFixtures(launch.id);
    await writeTestLake(lakeDir, {
      serverId: guildOne,
      matchFacts: [
        fact({
          playerId: launch.id,
          alias: launch.alias,
          puuid,
          matchId: RiotMatchIdSchema.parse("NA1_9200000001"),
          win: true,
        }),
      ],
      timelineFrames: review.timelineFrames,
      timelineEvents: review.timelineEvents,
      timelineCoverage: review.timelineCoverage,
      timelineEventParticipants: review.timelineEventParticipants,
    });
    const caller = trpc.authedCaller();
    const result = await caller.consumerMatch.reviewTimeline({
      playerId: launch.id,
      matchId: RiotMatchIdSchema.parse("NA1_9200000001"),
    });
    expect(result.events).toHaveLength(60);
    expect(result.frames).toHaveLength(310);
    expect(result.events.at(-1)?.type).toBe("GAME_END");
    expect(result.frames[0]).not.toHaveProperty("puuid");
    expect(result.events[0]?.participantIds).toContain(launch.id);
    await expect(
      caller.consumerMatch.reviewTimeline({
        playerId: launch.id,
        matchId: RiotMatchIdSchema.parse("NA1_9200000002"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    trpc.setMembership([]);
    await expect(
      caller.consumerMatch.reviewTimeline({
        playerId: launch.id,
        matchId: RiotMatchIdSchema.parse("NA1_9200000001"),
      }),
    ).rejects.toBeDefined();
  });
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
          matchId: RiotMatchIdSchema.parse(`NA1_81001${index.toString()}`),
          win: index < 7,
          index,
        }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        fact({
          playerId: two.id,
          alias: two.alias,
          puuid: twoPuuid,
          matchId: RiotMatchIdSchema.parse(`NA1_81003${index.toString()}`),
          win: index < 6,
          index,
        }),
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        fact({
          playerId: small.id,
          alias: small.alias,
          puuid: smallPuuid,
          matchId: RiotMatchIdSchema.parse(`NA1_81002${index.toString()}`),
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
            matchId: RiotMatchIdSchema.parse(
              `NA1_81009${index.toString().padStart(3, "0")}${gameIndex.toString().padStart(3, "0")}`,
            ),
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
          matchId: RiotMatchIdSchema.parse("NA1_9100000010"),
          win: true,
        }),
        fact({
          playerId: teammate.id,
          alias: teammate.alias,
          puuid: teammatePuuid,
          matchId: RiotMatchIdSchema.parse("NA1_9100000010"),
          win: false,
          championId: 86,
          championName: "Garen",
          teamId: 200,
        }),
      ],
    });

    const detail = await trpc.authedCaller().consumerMatch.detail({
      playerId: launch.id,
      matchId: RiotMatchIdSchema.parse("NA1_9100000010"),
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
    expect(detail.match.roleMatchups).toBeNull();
    expect(detail.match.teams[0]?.participants[0]?.loadout).toMatchObject({
      itemIds: [1055, 3006, 3031, 3094, 3072, 0, 3340],
      summonerSpellIds: [4, 7],
      runes: { primaryStyleId: 8000, primaryRuneIds: [8005, 8009, 9103, 8014] },
    });
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
          matchId: RiotMatchIdSchema.parse("NA1_9100000020"),
          win: true,
        }),
      ],
    });
    await expect(
      trpc.authedCaller().consumerMatch.detail({
        playerId: launch.id,
        matchId: RiotMatchIdSchema.parse("NA1_9100000020"),
      }),
    ).rejects.toThrow("Match was not found");
  });

  test("rejects an Arena match with missing participant subteams", async () => {
    const puuid = testPuuid("arena-no-subteam");
    const launch = await player({ guildId: guildOne, alias: "Arena", puuid });
    await writeTestLake(lakeDir, {
      serverId: guildOne,
      matchFacts: [
        fact({
          playerId: launch.id,
          alias: launch.alias,
          puuid,
          matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
          win: false,
          queue: "arena",
          queueId: 1700,
          gameMode: "CHERRY",
        }),
      ],
    });
    await expect(
      trpc.authedCaller().consumerMatch.detail({
        playerId: launch.id,
        matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
      }),
    ).rejects.toThrow("missing a participant subteam ID");
  });
});

const testLoadoutColumns = {
  item0: 1055,
  item1: 3006,
  item2: 3031,
  item3: 3094,
  item4: 3072,
  item5: 0,
  item6: 3340,
  summoner_spell_1_id: 4,
  summoner_spell_2_id: 7,
  primary_rune_style_id: 8000,
  primary_rune_0_id: 8005,
  primary_rune_1_id: 8009,
  primary_rune_2_id: 9103,
  primary_rune_3_id: 8014,
  secondary_rune_style_id: 8300,
  secondary_rune_0_id: 8304,
  secondary_rune_1_id: 8347,
  stat_perk_offense_id: 5005,
  stat_perk_flex_id: 5008,
  stat_perk_defense_id: 5002,
};

function matchupParticipant(options: {
  participantId: number;
  teamId: number;
  position: string;
}): LakeMatchParticipantRow {
  return {
    match_id: RiotMatchIdSchema.parse("NA1_9100000030"),
    game_creation_ms: created.getTime(),
    game_duration_seconds: 1800,
    queue: "solo",
    queue_id: 420,
    game_mode: "CLASSIC",
    game_type: "MATCHED_GAME",
    game_version: "16.18.1",
    map_id: 11,
    puuid: testPuuid(`role-${options.participantId.toString()}`),
    participant_id: options.participantId,
    team_id: options.teamId,
    player_subteam_id: null,
    placement: null,
    subteam_placement: null,
    augment_1_id: null,
    augment_2_id: null,
    augment_3_id: null,
    augment_4_id: null,
    augment_5_id: null,
    augment_6_id: null,
    riot_id_game_name: `Player ${options.participantId.toString()}`,
    riot_id_tagline: "NA1",
    champion_id: 22,
    champion_name: "Ashe",
    team_position: options.position,
    win: options.teamId === 100,
    kills: 5,
    deaths: 2,
    assists: 7,
    creep_score: 150,
    gold_earned: 10_000,
    vision_score: 20,
    total_damage_dealt_to_champions: 15_000,
    turret_kills: 1,
    inhibitor_kills: 0,
    baron_kills: 0,
    dragon_kills: 0,
    ...testLoadoutColumns,
  };
}

function matchupFrame(
  participantId: number,
  totalGold: number,
  creepScore: number,
  xp: number,
): LaneDeltaFrame {
  return {
    frame_timestamp_ms: 900_000,
    participant_id: participantId,
    total_gold: totalGold,
    minions_killed: creepScore,
    jungle_minions_killed: 0,
    xp,
  };
}

const completeAt15Coverage: LakeTimelineCoverage = {
  coverage_state: "complete",
  data_version: "2",
  frame_interval_ms: 60_000,
  frame_count: 16,
  event_count: 0,
  participant_count: 10,
  first_frame_timestamp_ms: 0,
  last_frame_timestamp_ms: 900_000,
};

describe("role-paired match scoreboards", () => {
  const positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
  const rows = positions.flatMap((position, index) => [
    matchupParticipant({
      participantId: index + 1,
      teamId: 100,
      position,
    }),
    matchupParticipant({
      participantId: index + 6,
      teamId: 200,
      position,
    }),
  ]);
  const frames = positions.flatMap((_, index) => [
    matchupFrame(index + 1, 5500, 120, 6500),
    matchupFrame(index + 6, 5000, 110, 6200),
  ]);

  test("pairs every standard role and computes blue-minus-red 15-minute deltas", () => {
    const matchups = buildRoleMatchups({
      rows,
      coverage: completeAt15Coverage,
      frames,
    });
    expect(matchups).toHaveLength(5);
    expect(matchups?.[0]).toEqual({
      role: "top",
      blueParticipantId: 1,
      redParticipantId: 6,
      at15: {
        timestampMs: 900_000,
        goldDelta: 500,
        creepScoreDelta: 10,
        xpDelta: 300,
      },
    });
  });

  test("falls back when the match is not strictly role-pairable", () => {
    expect(
      buildRoleMatchups({
        rows: rows.slice(0, -1),
        coverage: completeAt15Coverage,
        frames,
      }),
    ).toBeNull();
  });

  test("keeps rotating and non-Rift 5v5 games on the ordinary scoreboard", () => {
    for (const context of [
      { queue_id: 900 },
      { game_mode: "URF" },
      { map_id: 30 },
    ]) {
      expect(
        buildRoleMatchups({
          rows: rows.map((row) => ({ ...row, ...context })),
          coverage: completeAt15Coverage,
          frames,
        }),
      ).toBeNull();
    }
  });

  test("pairs custom CLASSIC games on Summoner's Rift", () => {
    for (const context of [
      { queue: "custom", queue_id: 0, game_type: "MATCHED_GAME" },
      { queue: null, queue_id: 3110, game_type: "CUSTOM_GAME" },
    ]) {
      const matchups = buildRoleMatchups({
        rows: rows.map((row) => ({
          ...row,
          ...context,
        })),
        coverage: null,
        frames: [],
      });
      expect(matchups).toHaveLength(5);
      expect(matchups?.every((matchup) => matchup.at15 === null)).toBe(true);
    }
  });

  test("fails when complete coverage omits a required 15-minute frame", () => {
    expect(() =>
      buildRoleMatchups({
        rows,
        coverage: completeAt15Coverage,
        frames: frames.slice(0, -1),
      }),
    ).toThrow(/missing a 15-minute lane frame/);
  });
});
