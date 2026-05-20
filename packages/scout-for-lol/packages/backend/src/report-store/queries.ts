import { z } from "zod";
import {
  CompetitionCriteriaSchema,
  type DiscordGuildId,
  type CompetitionQueueType,
  type PlayerId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { competitionQueueToStoredQueues } from "#src/report-store/queue.ts";

export type SurrenderLeaderRow = {
  playerId: number;
  playerAlias: string;
  discordId: string | null;
  games: number;
  surrenders: number;
  surrenderRate: number;
};

export type ReportLeaderboardEntry = {
  rank: number;
  playerId: number;
  playerName: string;
  discordId: string | null;
  score: number;
};

export async function getSurrenderLeadersFromSqlite(params: {
  prisma: ExtendedPrismaClient;
  serverId: DiscordGuildId;
  startDate: Date;
  endDate: Date;
  queues?: string[];
  minGames: number;
  limit: number;
}): Promise<SurrenderLeaderRow[]> {
  const facts =
    params.queues === undefined
      ? await params.prisma.matchParticipantFact.findMany({
          where: {
            serverId: params.serverId,
            gameCreationAt: {
              gte: params.startDate,
              lte: params.endDate,
            },
          },
        })
      : await params.prisma.matchParticipantFact.findMany({
          where: {
            serverId: params.serverId,
            queue: {
              in: params.queues,
            },
            gameCreationAt: {
              gte: params.startDate,
              lte: params.endDate,
            },
          },
        });

  const byPlayer = new Map<number, SurrenderLeaderRow>();
  for (const fact of facts) {
    const current = byPlayer.get(fact.playerId) ?? {
      playerId: fact.playerId,
      playerAlias: fact.playerAlias,
      discordId: fact.discordId,
      games: 0,
      surrenders: 0,
      surrenderRate: 0,
    };
    current.games++;
    if (fact.surrendered) {
      current.surrenders++;
    }
    byPlayer.set(fact.playerId, current);
  }

  return [...byPlayer.values()]
    .filter((row) => row.games >= params.minGames && row.surrenders > 0)
    .map((row) => ({
      ...row,
      surrenderRate: row.surrenders / row.games,
    }))
    .toSorted((a, b) => {
      const rateDiff = b.surrenderRate - a.surrenderRate;
      if (rateDiff !== 0) {
        return rateDiff;
      }
      return b.surrenders - a.surrenders;
    })
    .slice(0, params.limit);
}

function parseCompetitionCriteria(
  criteriaType: string,
  criteriaConfig: string,
) {
  const config = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(criteriaConfig));
  return CompetitionCriteriaSchema.parse({
    type: criteriaType,
    ...config,
  });
}

async function findCompetitionFacts(params: {
  prisma: ExtendedPrismaClient;
  serverId: DiscordGuildId;
  startDate: Date;
  endDate: Date;
  queue: CompetitionQueueType;
  playerIds: PlayerId[];
}) {
  const queues = competitionQueueToStoredQueues(params.queue);
  const commonWhere = {
    serverId: params.serverId,
    playerId: {
      in: params.playerIds,
    },
    gameCreationAt: {
      gte: params.startDate,
      lte: params.endDate,
    },
  };

  if (queues === undefined) {
    return await params.prisma.matchParticipantFact.findMany({
      where: commonWhere,
    });
  }

  return await params.prisma.matchParticipantFact.findMany({
    where: {
      ...commonWhere,
      queue: {
        in: queues,
      },
    },
  });
}

export async function getMostGamesPlayedCompetitionLeaderboardFromSqlite(
  prisma: ExtendedPrismaClient,
  competitionId: number,
): Promise<ReportLeaderboardEntry[]> {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    include: {
      participants: {
        include: {
          player: true,
        },
      },
    },
  });

  if (competition === null) {
    throw new Error(`Competition not found: ${competitionId.toString()}`);
  }

  if (competition.startDate === null) {
    throw new Error(
      `Competition ${competitionId.toString()} has no start date; cannot query report facts`,
    );
  }

  const criteria = parseCompetitionCriteria(
    competition.criteriaType,
    competition.criteriaConfig,
  );
  if (criteria.type !== "MOST_GAMES_PLAYED") {
    throw new Error(
      `SQLite proof query supports MOST_GAMES_PLAYED only, got ${criteria.type}`,
    );
  }

  const playerIds = competition.participants.map(
    (participant) => participant.playerId,
  );
  const facts = await findCompetitionFacts({
    prisma,
    serverId: competition.serverId,
    startDate: competition.startDate,
    endDate: competition.endDate ?? new Date(),
    queue: criteria.queue,
    playerIds,
  });

  const scoreByPlayer = new Map<number, number>();
  for (const fact of facts) {
    scoreByPlayer.set(
      fact.playerId,
      (scoreByPlayer.get(fact.playerId) ?? 0) + 1,
    );
  }

  return competition.participants
    .map((participant) => ({
      rank: 0,
      playerId: participant.playerId,
      playerName: participant.player.alias,
      discordId: participant.player.discordId,
      score: scoreByPlayer.get(participant.playerId) ?? 0,
    }))
    .toSorted((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.playerName.localeCompare(b.playerName);
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}
