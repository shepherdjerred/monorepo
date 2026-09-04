import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  MatchIdSchema,
  PlayerIdSchema,
  TimelineCursorSchema,
  TimelineEventFilterSchema,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";
import { prisma } from "#src/database/index.ts";
import {
  fetchFullMatch,
  fetchTimelineChartFrames,
  fetchTimelineCoverage,
  fetchTimelineEventPage,
  fetchTimelineFramePage,
  type LakeMatchParticipantRow,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const PAGE_SIZE = 100;
const KEY_EVENT_TYPES = [
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "GAME_END",
];

const MatchInput = z.object({
  playerId: PlayerIdSchema,
  matchId: MatchIdSchema,
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

async function authorizeMatch(
  user: User,
  input: z.infer<typeof MatchInput>,
): Promise<AuthorizedMatch> {
  const guilds = await assertConsumerPlayerScope(user);
  const guildIds = guilds.map((guild) => guild.id);
  const player = await prisma.player.findFirst({
    where: { id: input.playerId, serverId: { in: guildIds } },
    select: { id: true, accounts: { select: { puuid: true } } },
  });
  if (player === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Match was not found" });
  }
  const rows = await fetchFullMatch({ matchId: input.matchId });
  const playerPuuids = new Set<string>(
    player.accounts.map((account) => account.puuid),
  );
  if (!rows.some((row) => playerPuuids.has(row.puuid))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Match was not found" });
  }
  const trackedAccounts = await prisma.account.findMany({
    where: {
      puuid: { in: rows.map((row) => row.puuid) },
      player: { serverId: { in: guildIds } },
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
  return {
    player: { id: player.id, puuids: playerPuuids },
    rows,
    aliasesByPuuid,
  };
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

function matchView(match: AuthorizedMatch) {
  const first = match.rows[0];
  if (first === undefined) {
    throw new Error("Authorized match has no participants");
  }
  const totals = teamTotals(match.rows);
  const participants = match.rows.map((row) => {
    const team = totals.get(row.team_id);
    if (team === undefined) {
      throw new Error("Match participant has no team totals");
    }
    return {
      participantId: row.participant_id,
      teamId: row.team_id,
      selectedPlayer: match.player.puuids.has(row.puuid),
      riotId: {
        gameName: row.riot_id_game_name,
        tagLine: row.riot_id_tagline,
      },
      championId: row.champion_id,
      championName: row.champion_name,
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
      scoutAliases: match.aliasesByPuuid.get(row.puuid) ?? [],
    };
  });
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
        objectives: teamRows.reduce(
          (sum, participant) => ({
            turrets: sum.turrets + participant.objectives.turrets,
            inhibitors: sum.inhibitors + participant.objectives.inhibitors,
            barons: sum.barons + participant.objectives.barons,
            dragons: sum.dragons + participant.objectives.dragons,
          }),
          { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 },
        ),
      };
    },
  );
  return {
    matchId: first.match_id,
    gameCreationMs: first.game_creation_ms,
    gameDurationSeconds: first.game_duration_seconds,
    queue: first.queue,
    queueId: first.queue_id,
    gameMode: first.game_mode,
    gameType: first.game_type,
    gameVersion: first.game_version,
    mapId: first.map_id,
    teams,
  };
}

function pageResult<T>(rows: T[], offset: number) {
  const page = rows.slice(0, PAGE_SIZE);
  return {
    rows: page,
    nextCursor: rows.length > PAGE_SIZE ? { offset: offset + PAGE_SIZE } : null,
  };
}

function participantFilter(participantIds: number[] | undefined) {
  return participantIds === undefined ? {} : { participantIds };
}

export const consumerMatchRouter = router({
  detail: protectedProcedure.input(MatchInput).query(async ({ ctx, input }) => {
    const authorized = await authorizeMatch(ctx.user, input);
    const [coverage, keyEvents] = await Promise.all([
      fetchTimelineCoverage({ matchId: input.matchId }),
      fetchTimelineEventPage({
        matchId: input.matchId,
        offset: 0,
        limit: 40,
        eventTypes: KEY_EVENT_TYPES,
      }),
    ]);
    return { match: matchView(authorized), timeline: { coverage, keyEvents } };
  }),

  events: protectedProcedure
    .input(TimelineEventPageInput)
    .query(async ({ ctx, input }) => {
      await authorizeMatch(ctx.user, input);
      const offset = input.cursor?.offset ?? 0;
      const rows = await fetchTimelineEventPage({
        matchId: input.matchId,
        offset,
        limit: PAGE_SIZE + 1,
        ...(input.eventTypes === undefined
          ? {}
          : { eventTypes: input.eventTypes }),
        ...participantFilter(input.participantIds),
      });
      return pageResult(rows, offset);
    }),

  frames: protectedProcedure
    .input(TimelinePageInput)
    .query(async ({ ctx, input }) => {
      await authorizeMatch(ctx.user, input);
      const offset = input.cursor?.offset ?? 0;
      const rows = await fetchTimelineFramePage({
        matchId: input.matchId,
        offset,
        limit: PAGE_SIZE + 1,
        ...participantFilter(input.participantIds),
      });
      return pageResult(rows, offset);
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
          .filter((row) => authorized.player.puuids.has(row.puuid))
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
      return {
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
});
