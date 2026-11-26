import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test, vi } from "vitest";
import type * as InstanceModule from "#src/reports/duckdb/instance.ts";
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
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import { storyMatchFixture } from "#src/testing/report-lake/story-match-fixture.ts";
import { STORY_VIEWER_PARTICIPANT_ID } from "#src/testing/report-lake/story-match-seats.ts";

// Counts every report-pool slot a call takes, by wrapping the real pool.
const slots = vi.hoisted(() => ({ taken: 0 }));
vi.mock("#src/reports/duckdb/instance.ts", async () => {
  const actual = await vi.importActual<typeof InstanceModule>(
    "#src/reports/duckdb/instance.ts",
  );
  return {
    ...actual,
    withDuckDBConnection: (
      ...args: Parameters<typeof actual.withDuckDBConnection>
    ) => {
      slots.taken += 1;
      return actual.withDuckDBConnection(...args);
    },
  };
});

const guildId = DiscordGuildIdSchema.parse("100000000000000081");
const profileFeature = configureConsumerProfileFeatureTest([guildId]);
const trpc = await createOfflineTrpcHarness("consumer-match-story-test");
// Loaded after the harness so it binds the harness's Discord stubs.
const accessModule = await import("#src/consumer/access.ts");
const actor = DiscordAccountIdSchema.parse("300000000000000081");
const { lakeDir } = profileFeature;
const created = new Date("2026-08-25T12:00:00.000Z");
const MATCH = RiotMatchIdSchema.parse("NA1_9400000001");
const VIEWER_PUUID = testPuuid("story-viewer");

function puuidOf(participantId: number): LeaguePuuid {
  return testPuuid(`story-participant-${participantId.toString()}`);
}

async function trackedPlayer(options: {
  guildId: DiscordGuildId;
  alias: string;
  puuid: LeaguePuuid;
}) {
  const row = await trpc.prisma.player.create({
    data: {
      serverId: options.guildId,
      alias: options.alias,
      creatorDiscordId: actor,
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

registerConsumerProfileFeatureTestLifecycle({
  feature: profileFeature,
  prepare: async () => {
    profileFeature.enable(guildId);
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await trpc.prisma.matchRankHistory.deleteMany();
    await trpc.prisma.account.deleteMany();
    await trpc.prisma.player.deleteMany();
    await profileFeature.resetLake();
  },
  cleanup: async () => {
    await trpc.prisma.$disconnect();
  },
});

async function seedStoryMatch(
  options: {
    matchId?: RiotMatchId;
    withTimeline?: boolean;
    remake?: boolean;
    queueId?: number;
  } = {},
) {
  const viewer = await trackedPlayer({
    guildId,
    alias: "Northstar",
    puuid: VIEWER_PUUID,
  });
  const friend = await trackedPlayer({
    guildId,
    alias: "RiverQuartz",
    puuid: puuidOf(4),
  });
  const fixture = storyMatchFixture({
    matchId: options.matchId ?? MATCH,
    gameCreationAt: created,
    viewer: {
      playerId: viewer.id,
      playerAlias: viewer.alias,
      puuid: VIEWER_PUUID,
    },
    puuidOf,
    ...(options.withTimeline === undefined
      ? {}
      : { withTimeline: options.withTimeline }),
    ...(options.remake === undefined ? {} : { remake: options.remake }),
    ...(options.queueId === undefined ? {} : { queueId: options.queueId }),
  });
  await writeTestLake(lakeDir, {
    serverId: guildId,
    matchFacts: fixture.matchFacts,
    untrackedMatchFacts: fixture.untrackedMatchFacts,
    timelineFrames: fixture.timelineFrames,
    timelineEvents: fixture.timelineEvents,
    timelineEventParticipants: fixture.timelineEventParticipants,
    timelineCoverage: fixture.timelineCoverage,
  });
  return { viewer, friend };
}

const SOLO_BEFORE = JSON.stringify({
  tier: "emerald",
  division: 2,
  lp: 43,
  wins: 50,
  losses: 44,
});
const SOLO_AFTER = JSON.stringify({
  tier: "emerald",
  division: 2,
  lp: 64,
  wins: 51,
  losses: 44,
});

async function recordRank(options: {
  puuid: LeaguePuuid;
  queueType?: string;
  before: string | null;
  after: string | null;
  matchId?: RiotMatchId;
}) {
  await trpc.prisma.matchRankHistory.create({
    data: {
      matchId: options.matchId ?? MATCH,
      puuid: options.puuid,
      queueType: options.queueType ?? "solo",
      rankBefore: options.before,
      rankAfter: options.after,
      capturedAt: created,
    },
  });
}

describe("consumerMatch.story", () => {
  test("returns the timeline's moments, every build order and the skill order for a tracked match", async () => {
    const { viewer } = await seedStoryMatch();
    slots.taken = 0;
    const story = await trpc
      .authedCaller(actor)
      .consumerMatch.story({ playerId: viewer.id, matchId: MATCH });

    expect(story.coverage).toBe("timeline");
    expect(story.remake).toBe(false);
    expect(story.winnerTeamId).toBe(100);
    expect(story.moments.map((moment) => moment.text)).toEqual([
      "First blood at 3:12 by Northstar",
      "Infernal dragon at 7:05 by Velour",
      "Rift Herald at 9:50 by Velour",
      "Outer bot tower at 11:02 by RiverQuartz",
      "Ocean dragon at 13:20 by Ninefold",
      "Outer top tower at 16:40 by Mossback",
      "Triple kill at 20:23 by RiverQuartz",
      "Deciding fight at 24:20, 5 kills to 1",
      "Ace at 24:36 by Northstar",
      "Baron at 24:40 by Northstar",
      "Bot inhibitor at 26:10 by RiverQuartz",
    ]);
    const timestamps = story.moments.map((moment) => moment.timestampMs);
    expect(timestamps).toEqual(
      timestamps.toSorted((left, right) => left - right),
    );
    expect(story.moments[0]).toMatchObject({
      kind: "first_blood",
      teamId: 100,
      players: [
        {
          participantId: 3,
          displayName: "Northstar",
          championName: "Ahri",
          role: "killer",
        },
        {
          participantId: 8,
          displayName: "Windlass",
          championName: "Yasuo",
          role: "victim",
        },
      ],
    });

    const viewerSeat = story.participants.find((entry) => entry.selectedPlayer);
    expect(viewerSeat?.participantId).toBe(STORY_VIEWER_PARTICIPANT_ID);
    // Consumables, the trinket and the undone Needlessly Large Rod are not in
    // the build; the sold Doran's Ring is, marked with when it was sold.
    expect(
      viewerSeat?.buildOrder?.map((step) => [
        step.itemId,
        step.minute,
        step.soldAtMs,
      ]),
    ).toEqual([
      [1056, 0, 21 * 60_000],
      [1052, 5, null],
      [3802, 6, null],
      [3118, 9, null],
      [1001, 11, null],
      [3020, 12, null],
      [4645, 15, null],
      [3089, 19, null],
      [3157, 24, null],
    ]);
    expect(viewerSeat?.skillOrder).toHaveLength(18);
    expect(viewerSeat?.skillOrder?.slice(0, 6)).toEqual([
      "Q",
      "W",
      "E",
      "Q",
      "Q",
      "R",
    ]);
    expect(story.participants).toHaveLength(10);
    expect(
      story.participants.every((entry) => (entry.buildOrder ?? []).length > 0),
    ).toBe(true);

    expect(story.goldLead?.teamId).toBe(100);
    expect(story.goldLead?.points).toHaveLength(29);
    expect(story.goldLead?.points.at(-1)).toMatchObject({
      minute: 28,
      leadGold: 9200,
    });
    expect(
      story.goldLead?.points.find((point) => point.minute === 7)?.leadGold,
    ).toBe(-500);
    expect(slots.taken).toBe(1);
  });

  test("takes one lake slot per call and none for a viewer outside the match", async () => {
    const { viewer } = await seedStoryMatch();
    const stranger = await trackedPlayer({
      guildId,
      alias: "Stranger",
      puuid: testPuuid("story-stranger"),
    });
    const caller = trpc.authedCaller(actor);
    slots.taken = 0;
    await caller.consumerMatch.story({ playerId: viewer.id, matchId: MATCH });
    expect(slots.taken).toBe(1);
    await caller.consumerMatch.story({ playerId: viewer.id, matchId: MATCH });
    expect(slots.taken).toBe(2);
    await expect(
      caller.consumerMatch.story({ playerId: stranger.id, matchId: MATCH }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a match with no timeline returns end-of-game facts only, typed", async () => {
    const { viewer } = await seedStoryMatch({ withTimeline: false });
    const story = await trpc
      .authedCaller(actor)
      .consumerMatch.story({ playerId: viewer.id, matchId: MATCH });
    expect(story.coverage).toBe("end_of_game");
    expect(story.moments).toEqual([]);
    expect(story.goldLead).toBeNull();
    expect(story.participants).toHaveLength(10);
    for (const entry of story.participants) {
      expect(entry.buildOrder).toBeNull();
      expect(entry.skillOrder).toBeNull();
    }
    expect(story.participants[2]?.finalItemIds).toEqual([
      1055, 3006, 3031, 3094, 3072, 3340,
    ]);
    expect(story.teams).toEqual([
      {
        teamId: 100,
        win: true,
        objectives: { turrets: 5, inhibitors: 0, barons: 0, dragons: 0 },
      },
      {
        teamId: 200,
        win: false,
        objectives: { turrets: 5, inhibitors: 0, barons: 0, dragons: 0 },
      },
    ]);
  });

  test("a remake is flagged, names no winner and has no deciding fight", async () => {
    const { viewer } = await seedStoryMatch({ remake: true });
    const story = await trpc
      .authedCaller(actor)
      .consumerMatch.story({ playerId: viewer.id, matchId: MATCH });
    expect(story.remake).toBe(true);
    expect(story.winnerTeamId).toBeNull();
    expect(
      story.moments.some((moment) => moment.kind === "deciding_fight"),
    ).toBe(false);
    expect(story.moments.some((moment) => moment.kind === "first_blood")).toBe(
      true,
    );
  });

  test("is forbidden outside the rollout and unavailable when membership cannot be confirmed", async () => {
    const { viewer } = await seedStoryMatch();
    const caller = trpc.authedCaller(actor);
    trpc.setMembership([]);
    await expect(
      caller.consumerMatch.story({ playerId: viewer.id, matchId: MATCH }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    trpc.setMembership([{ guildId, asAdmin: false }]);
    vi.spyOn(accessModule, "resolveConsumerGuildAccess").mockResolvedValueOnce({
      kind: "unavailable",
    });
    slots.taken = 0;
    await expect(
      caller.consumerMatch.story({ playerId: viewer.id, matchId: MATCH }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    // Neither refusal reached the lake.
    expect(slots.taken).toBe(0);
  });
});

describe("consumerMatch.detail lpDelta", () => {
  test("carries the captured rank change for each tracked participant and null for the rest", async () => {
    const { viewer } = await seedStoryMatch();
    await recordRank({
      puuid: VIEWER_PUUID,
      before: SOLO_BEFORE,
      after: SOLO_AFTER,
    });
    const detail = await trpc
      .authedCaller(actor)
      .consumerMatch.detail({ playerId: viewer.id, matchId: MATCH });
    const participants = detail.match.teams.flatMap(
      (team) => team.participants,
    );
    const byParticipant = new Map(
      participants.map(
        (entry) => [entry.participantId, entry.lpDelta] as const,
      ),
    );
    expect(byParticipant.get(3)).toMatchObject({
      queueType: "solo",
      delta: 21,
      rankBefore: { tier: "emerald", division: 2, lp: 43 },
      rankAfter: { tier: "emerald", division: 2, lp: 64 },
    });
    // RiverQuartz is tracked but nothing was captured for them: null, not zero.
    expect(byParticipant.get(4)).toBeNull();
    expect(byParticipant.get(8)).toBeNull();
    expect(detail.match.remake).toBe(false);
  });

  test("counts a promotion in ladder points, so 90 LP in III to 20 LP in II is 30", async () => {
    const { viewer } = await seedStoryMatch();
    await recordRank({
      puuid: VIEWER_PUUID,
      before: JSON.stringify({
        tier: "emerald",
        division: 3,
        lp: 90,
        wins: 1,
        losses: 1,
      }),
      after: JSON.stringify({
        tier: "emerald",
        division: 2,
        lp: 20,
        wins: 2,
        losses: 1,
      }),
    });
    const detail = await trpc
      .authedCaller(actor)
      .consumerMatch.detail({ playerId: viewer.id, matchId: MATCH });
    expect(
      detail.match.teams
        .flatMap((team) => team.participants)
        .find((entry) => entry.participantId === 3)?.lpDelta?.delta,
    ).toBe(30);
  });

  test("is null when nothing was captured, for a first ranked game's difference, across the Master line, and for a flex record on a solo game", async () => {
    const { viewer } = await seedStoryMatch();
    const caller = trpc.authedCaller(actor);
    const lpOf = async () => {
      const detail = await caller.consumerMatch.detail({
        playerId: viewer.id,
        matchId: MATCH,
      });
      return detail.match.teams
        .flatMap((team) => team.participants)
        .find((entry) => entry.participantId === 3)?.lpDelta;
    };
    expect(await lpOf()).toBeNull();

    await recordRank({
      puuid: VIEWER_PUUID,
      queueType: "flex",
      before: SOLO_BEFORE,
      after: SOLO_AFTER,
    });
    expect(await lpOf()).toBeNull();

    await recordRank({ puuid: VIEWER_PUUID, before: null, after: SOLO_AFTER });
    expect(await lpOf()).toMatchObject({
      delta: null,
      rankBefore: null,
      rankAfter: { division: 2, lp: 64 },
    });

    await trpc.prisma.matchRankHistory.deleteMany({
      where: { puuid: VIEWER_PUUID, queueType: "solo" },
    });
    await recordRank({
      puuid: VIEWER_PUUID,
      before: JSON.stringify({
        tier: "diamond",
        division: 1,
        lp: 80,
        wins: 1,
        losses: 1,
      }),
      after: JSON.stringify({
        tier: "master",
        division: 1,
        lp: 12,
        wins: 2,
        losses: 1,
      }),
    });
    expect(await lpOf()).toMatchObject({
      delta: null,
      rankAfter: { tier: "master" },
    });
  });

  test("states no rank change for a remake or an unranked queue even when one was recorded", async () => {
    const { viewer } = await seedStoryMatch({ remake: true });
    await recordRank({
      puuid: VIEWER_PUUID,
      before: SOLO_BEFORE,
      after: SOLO_AFTER,
    });
    const caller = trpc.authedCaller(actor);
    const remade = await caller.consumerMatch.detail({
      playerId: viewer.id,
      matchId: MATCH,
    });
    expect(remade.match.remake).toBe(true);
    expect(
      remade.match.teams
        .flatMap((team) => team.participants)
        .every((entry) => entry.lpDelta === null),
    ).toBe(true);

    const normal = RiotMatchIdSchema.parse("NA1_9400000002");
    await seedNormalQueueMatch(normal, viewer.id);
    await recordRank({
      puuid: VIEWER_PUUID,
      before: SOLO_BEFORE,
      after: SOLO_AFTER,
      matchId: normal,
    });
    const unranked = await caller.consumerMatch.detail({
      playerId: viewer.id,
      matchId: normal,
    });
    expect(
      unranked.match.teams
        .flatMap((team) => team.participants)
        .every((entry) => entry.lpDelta === null),
    ).toBe(true);
  });
});

async function seedNormalQueueMatch(matchId: RiotMatchId, viewerId: number) {
  const fixture = storyMatchFixture({
    matchId,
    gameCreationAt: created,
    viewer: {
      playerId: viewerId,
      playerAlias: "Northstar",
      puuid: VIEWER_PUUID,
    },
    puuidOf,
    withTimeline: false,
    queueId: 400,
  });
  await writeTestLake(lakeDir, {
    serverId: guildId,
    matchFacts: fixture.matchFacts,
    untrackedMatchFacts: fixture.untrackedMatchFacts,
  });
}

describe("consumerMatch.chartSeries gold lead", () => {
  test("measures the viewer's team lead at each frame", async () => {
    const { viewer } = await seedStoryMatch();
    const result = await trpc
      .authedCaller(actor)
      .consumerMatch.chartSeries({ playerId: viewer.id, matchId: MATCH });
    expect(result.goldLead?.teamId).toBe(100);
    expect(
      result.goldLead?.points.map((point) => point.leadGold).slice(0, 8),
    ).toEqual([0, 0, 120, 60, -80, -150, -310, -500]);
    expect(result.goldLead?.points.at(-1)).toMatchObject({
      minute: 28,
      leadGold: 9200,
    });
    expect(result.points).toHaveLength(29);
  });
});
