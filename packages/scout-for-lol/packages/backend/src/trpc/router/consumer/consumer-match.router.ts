import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  RiotMatchIdSchema,
  PlayerIdSchema,
  TimelineCursorSchema,
  TimelineEventFilterSchema,
  isArenaQueueOrMode,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";
import { prisma } from "#src/database/index.ts";
import { arenaAugmentsFromLakeRow } from "#src/report-lake/arena.ts";
import {
  matchRowChampionName,
  matchRowLoadout,
  orderMatchRows,
} from "#src/explore-match/match-row-view.ts";
import { normalizeRiotIdPart } from "#src/explore-match/match-view.ts";
import {
  fetchFullMatch,
  fetchTimelineChartFrames,
  type LakeMatchParticipantRow,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { fetchMatchDetailRead } from "#src/reports/duckdb/consumer/match-detail-reads.ts";
import { fetchMatchStoryRead } from "#src/reports/duckdb/consumer/match-story-reads.ts";
import { buildGoldLead } from "#src/trpc/router/consumer/match-gold-lead.ts";
import {
  loadMatchLpDeltas,
  type MatchLpDelta,
} from "#src/trpc/router/consumer/match-lp-delta.ts";
import {
  buildMatchStory,
  matchWasRemade,
} from "#src/trpc/router/consumer/consumer-match-story.ts";
import { teamObjectives } from "#src/trpc/router/consumer/match-team-objectives.ts";
import {
  buildRoleMatchups,
  LANE_DELTA_CHECKPOINT_MS,
} from "#src/trpc/router/consumer/consumer-match-role-matchups.ts";
import {
  fetchMatchTimelineEvents,
  fetchMatchReviewTimeline,
  fetchMatchTimelineFrames,
  MATCH_KEY_EVENT_TYPES,
} from "#src/trpc/router/match-timeline.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const MatchInput = z.object({
  playerId: PlayerIdSchema,
  matchId: RiotMatchIdSchema,
});

const TimelinePageInput = MatchInput.extend({
  participantIds: TimelineEventFilterSchema.shape.participantIds,
  cursor: TimelineCursorSchema.optional(),
});

const TimelineEventPageInput = TimelinePageInput.extend({
  eventTypes: TimelineEventFilterSchema.shape.eventTypes,
});

type AuthorizedMatch = {
  player: { id: number; puuids: Set<string> };
  rows: LakeMatchParticipantRow[];
  aliasesByPuuid: Map<
    string,
    { playerId: number; alias: string; guildName: string }[]
  >;
};

type ScopedPlayer = {
  guilds: Awaited<ReturnType<typeof assertConsumerPlayerScope>>;
  player: { id: number; puuids: Set<string> };
};

/** The viewer's guilds and the named player, before any lake read. */
async function findScopedPlayer(
  user: User,
  input: z.infer<typeof MatchInput>,
): Promise<ScopedPlayer> {
  const guilds = await assertConsumerPlayerScope(user);
  const player = await prisma.player.findFirst({
    where: {
      id: input.playerId,
      serverId: { in: guilds.map((guild) => guild.id) },
    },
    select: { id: true, accounts: { select: { puuid: true } } },
  });
  if (player === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Match was not found" });
  }
  return {
    guilds,
    player: {
      id: player.id,
      puuids: new Set<string>(player.accounts.map((account) => account.puuid)),
    },
  };
}

/** Confirms the player was in the match and names the tracked participants. */
async function completeAuthorization(
  scoped: ScopedPlayer,
  rows: LakeMatchParticipantRow[],
): Promise<AuthorizedMatch> {
  const { guilds, player } = scoped;
  if (!rows.some((row) => isPlayerRow(row, player.puuids))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Match was not found" });
  }
  const trackedAccounts = await prisma.account.findMany({
    where: {
      puuid: {
        in: rows.flatMap((row) => (row.puuid === null ? [] : [row.puuid])),
      },
      player: { serverId: { in: guilds.map((guild) => guild.id) } },
    },
    select: {
      puuid: true,
      player: { select: { id: true, alias: true, serverId: true } },
    },
  });
  const guildNameById = new Map(
    guilds.map((guild) => [guild.id, guild.name] as const),
  );
  const aliasesByPuuid = new Map<
    string,
    { playerId: number; alias: string; guildName: string }[]
  >();
  for (const account of trackedAccounts) {
    const guildName = guildNameById.get(account.player.serverId);
    if (guildName === undefined) {
      throw new Error("Tracked match alias resolved outside its request scope");
    }
    const aliases = aliasesByPuuid.get(account.puuid) ?? [];
    aliases.push({
      playerId: account.player.id,
      alias: account.player.alias,
      guildName,
    });
    aliasesByPuuid.set(account.puuid, aliases);
  }
  return { player, rows, aliasesByPuuid };
}

async function authorizeMatch(
  user: User,
  input: z.infer<typeof MatchInput>,
): Promise<AuthorizedMatch> {
  const scoped = await findScopedPlayer(user, input);
  const rows = await fetchFullMatch({ matchId: input.matchId });
  return await completeAuthorization(scoped, rows);
}

/** Whether a roster row is one of these accounts; a non-player row never is. */
function isPlayerRow(
  row: Pick<LakeMatchParticipantRow, "puuid">,
  puuids: ReadonlySet<string>,
): boolean {
  return row.puuid !== null && puuids.has(row.puuid);
}

function teamTotals(rows: LakeMatchParticipantRow[]) {
  const totals = new Map<number, { kills: number; damage: number }>();
  for (const row of rows) {
    const current = totals.get(row.team_id) ?? { kills: 0, damage: 0 };
    current.kills += row.kills;
    current.damage += row.total_damage_dealt_to_champions;
    totals.set(row.team_id, current);
  }
  return totals;
}

function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

function matchView(
  match: AuthorizedMatch,
  lpByPuuid: ReadonlyMap<string, MatchLpDelta>,
) {
  const first = match.rows[0];
  if (first === undefined) {
    throw new Error("Authorized match has no participants");
  }
  const totals = teamTotals(match.rows);
  const participants = orderMatchRows(match.rows).map((row) => {
    const team = totals.get(row.team_id);
    if (team === undefined) {
      throw new Error("Match participant has no team totals");
    }
    return {
      participantId: row.participant_id,
      teamId: row.team_id,
      subteamId: row.player_subteam_id,
      placement: row.subteam_placement ?? row.placement,
      augments: arenaAugmentsFromLakeRow(row),
      selectedPlayer: isPlayerRow(row, match.player.puuids),
      riotId: {
        gameName: normalizeRiotIdPart(row.riot_id_game_name),
        tagLine: normalizeRiotIdPart(row.riot_id_tagline),
      },
      championId: row.champion_id,
      championName: matchRowChampionName(row),
      position: row.team_position,
      win: row.win,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      creepScore: row.creep_score,
      goldEarned: row.gold_earned,
      visionScore: row.vision_score,
      damageToChampions: row.total_damage_dealt_to_champions,
      killParticipation: ratio(row.kills + row.assists, team.kills),
      damageShare: ratio(row.total_damage_dealt_to_champions, team.damage),
      objectives: {
        turrets: row.turret_kills,
        inhibitors: row.inhibitor_kills,
        barons: row.baron_kills,
        dragons: row.dragon_kills,
      },
      loadout: matchRowLoadout(row),
      scoutAliases:
        row.puuid === null ? [] : (match.aliasesByPuuid.get(row.puuid) ?? []),
      lpDelta: row.puuid === null ? null : (lpByPuuid.get(row.puuid) ?? null),
    };
  });
  const arenaSubteamIds = isArenaQueueOrMode(first.queue_id, first.game_mode)
    ? match.rows.map((row) => {
        if (row.player_subteam_id === null) {
          throw new Error(
            `Arena match ${first.match_id} is missing a participant subteam ID`,
          );
        }
        return row.player_subteam_id;
      })
    : null;
  const teams = [...new Set(match.rows.map((row) => row.team_id))].map(
    (teamId) => {
      const teamRows = participants.filter(
        (participant) => participant.teamId === teamId,
      );
      const teamFirst = teamRows[0];
      if (teamFirst === undefined) {
        throw new Error("Match team has no participants");
      }
      return {
        teamId,
        win: teamFirst.win,
        participants: teamRows,
        objectives: teamObjectives(teamRows),
      };
    },
  );
  return {
    matchId: first.match_id,
    gameCreationMs: first.game_creation_ms,
    gameDurationSeconds: first.game_duration_seconds,
    queue: first.queue,
    queueId: first.queue_id,
    remake: matchWasRemade(match.rows),
    gameMode: first.game_mode,
    gameType: first.game_type,
    gameVersion: first.game_version,
    mapId: first.map_id,
    arenaSubteams:
      arenaSubteamIds === null
        ? null
        : [...new Set(arenaSubteamIds)]
            .map((subteamId) => ({
              subteamId,
              participants: participants.filter(
                (participant) => participant.subteamId === subteamId,
              ),
            }))
            .toSorted(
              (left, right) =>
                (left.participants[0]?.placement ?? Number.MAX_SAFE_INTEGER) -
                (right.participants[0]?.placement ?? Number.MAX_SAFE_INTEGER),
            ),
    teams,
  };
}

export const consumerMatchRouter = router({
  detail: protectedProcedure.input(MatchInput).query(async ({ ctx, input }) => {
    const scoped = await findScopedPlayer(ctx.user, input);
    // One lake slot for the roster and the timeline reads. Nothing read here
    // reaches the caller until the roster confirms the viewer's player played.
    const read = await fetchMatchDetailRead({
      matchId: input.matchId,
      checkpointMs: LANE_DELTA_CHECKPOINT_MS,
      keyEventTypes: MATCH_KEY_EVENT_TYPES,
    });
    const authorized = await completeAuthorization(scoped, read.rows);
    const first = authorized.rows[0];
    if (first === undefined) {
      throw new Error("Authorized match has no participants");
    }
    const lpByPuuid = await loadMatchLpDeltas({
      matchId: input.matchId,
      queueId: first.queue_id,
      remake: matchWasRemade(authorized.rows),
      puuids: [...authorized.aliasesByPuuid.keys()],
    });
    return {
      match: {
        ...matchView(authorized, lpByPuuid),
        roleMatchups: buildRoleMatchups({
          rows: authorized.rows,
          frames: read.laneDeltaFrames,
        }),
      },
      timeline: { coverage: read.coverage, keyEvents: read.keyEvents },
    };
  }),

  events: protectedProcedure
    .input(TimelineEventPageInput)
    .query(async ({ ctx, input }) => {
      await authorizeMatch(ctx.user, input);
      return await fetchMatchTimelineEvents(input);
    }),

  frames: protectedProcedure
    .input(TimelinePageInput)
    .query(async ({ ctx, input }) => {
      await authorizeMatch(ctx.user, input);
      return await fetchMatchTimelineFrames(input);
    }),

  reviewTimeline: protectedProcedure
    .input(MatchInput)
    .query(async ({ ctx, input }) => {
      await authorizeMatch(ctx.user, input);
      return await fetchMatchReviewTimeline({ matchId: input.matchId });
    }),

  chartSeries: protectedProcedure
    .input(MatchInput)
    .query(async ({ ctx, input }) => {
      const authorized = await authorizeMatch(ctx.user, input);
      const frames = await fetchTimelineChartFrames({
        matchId: input.matchId,
      });
      const teamByParticipant = new Map(
        authorized.rows.map(
          (row) => [row.participant_id, row.team_id] as const,
        ),
      );
      const selectedParticipants = new Set(
        authorized.rows
          .filter((row) => isPlayerRow(row, authorized.player.puuids))
          .map((row) => row.participant_id),
      );
      const points = new Map<
        number,
        {
          teamGold: Map<number, number>;
          selectedGold: number | null;
          selectedXp: number | null;
        }
      >();
      for (const frame of frames) {
        const teamId = teamByParticipant.get(frame.participant_id);
        if (teamId === undefined) {
          throw new Error("Timeline frame references an unknown participant");
        }
        const point = points.get(frame.frame_timestamp_ms) ?? {
          teamGold: new Map<number, number>(),
          selectedGold: null,
          selectedXp: null,
        };
        point.teamGold.set(
          teamId,
          (point.teamGold.get(teamId) ?? 0) + frame.total_gold,
        );
        if (selectedParticipants.has(frame.participant_id)) {
          point.selectedGold = frame.total_gold;
          point.selectedXp = frame.xp;
        }
        points.set(frame.frame_timestamp_ms, point);
      }
      const viewerTeamId = authorized.rows.find((row) =>
        isPlayerRow(row, authorized.player.puuids),
      )?.team_id;
      return {
        goldLead:
          viewerTeamId === undefined
            ? null
            : buildGoldLead({
                frames,
                teamByParticipant: new Map(
                  [...teamByParticipant].flatMap(([id, teamId]) =>
                    id === null ? [] : [[id, teamId] as const],
                  ),
                ),
                viewerTeamId,
              }),
        points: [...points.entries()]
          .toSorted(([left], [right]) => left - right)
          .map(([timestampMs, point]) => ({
            timestampMs,
            teamGold: [...point.teamGold.entries()]
              .toSorted(([left], [right]) => left - right)
              .map(([teamId, gold]) => ({ teamId, gold })),
            selectedGold: point.selectedGold,
            selectedXp: point.selectedXp,
          })),
      };
    }),

  story: protectedProcedure.input(MatchInput).query(async ({ ctx, input }) => {
    const scoped = await findScopedPlayer(ctx.user, input);
    // One lake slot for the roster and the whole timeline. Nothing read here
    // reaches the caller until the roster confirms the viewer's player played.
    const read = await fetchMatchStoryRead({ matchId: input.matchId });
    const authorized = await completeAuthorization(scoped, read.rows);
    return buildMatchStory({
      read,
      aliasesByPuuid: authorized.aliasesByPuuid,
      viewerPuuids: authorized.player.puuids,
    });
  }),
});
