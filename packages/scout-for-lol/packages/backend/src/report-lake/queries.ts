import { z } from "zod";
import {
  CompetitionCriteriaSchema,
  type DiscordGuildId,
  type CompetitionQueueType,
  type PlayerId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { competitionQueueToStoredQueues } from "#src/report-store/queue.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildAccountsSource,
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import type {
  ReportLeaderboardEntry,
  SurrenderLeaderRow,
} from "#src/report-store/queries.ts";

/**
 * Lake-backed ports of the report-store proof queries
 * (report-store/queries.ts). Result types and semantics are identical —
 * pinned by report-lake/queries.integration.test.ts — so the fact-table
 * originals can be deleted together with the fact tables in the follow-up
 * PR.
 */

const PlayerAggregateRowSchema = z.object({
  player_id: z.union([z.bigint(), z.number()]).transform(Number),
  player_alias: z.string(),
  discord_id: z.string().nullable(),
  games: z.union([z.bigint(), z.number()]).transform(Number),
  surrenders: z.union([z.bigint(), z.number()]).transform(Number),
});

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): (string | number | ReturnType<DuckDBSession["list"]>)[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

async function fetchPlayerAggregates(params: {
  serverId: DiscordGuildId;
  startDate: Date;
  endDate: Date;
  queues?: string[];
  playerIds?: number[];
}): Promise<z.infer<typeof PlayerAggregateRowSchema>[]> {
  const lakeDir = resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  if (files.accountsParquet === undefined) {
    return [];
  }

  const predicates: SqlFragment[] = [
    {
      sql: "epoch_ms(game_creation_at) BETWEEN ? AND ?",
      params: [
        scalarParam(params.startDate.getTime()),
        scalarParam(params.endDate.getTime()),
      ],
    },
  ];
  if (params.queues !== undefined) {
    predicates.push({
      sql: "queue IN (SELECT unnest(?))",
      params: [listParam(params.queues)],
    });
  }
  const predicate: SqlFragment = {
    sql: predicates.map((fragment) => fragment.sql).join(" AND "),
    params: predicates.flatMap((fragment) => fragment.params),
  };

  const source = buildMatchesSource(files, predicate);
  if (source === undefined) {
    return [];
  }
  const accounts = buildAccountsSource(files.accountsParquet, params.serverId);
  const playerScope: SqlFragment =
    params.playerIds === undefined
      ? { sql: "", params: [] }
      : {
          sql: " WHERE a.player_id IN (SELECT unnest(?))",
          params: [listParam(params.playerIds)],
        };

  const sql =
    `WITH accounts AS (${accounts.sql}), ` +
    `facts AS (SELECT a.player_id, a.player_alias, a.discord_id, m.surrendered ` +
    `FROM (${source.sql}) m JOIN accounts a ON a.puuid = m.puuid${playerScope.sql}) ` +
    `SELECT player_id, any_value(player_alias) AS player_alias, ` +
    `any_value(discord_id) AS discord_id, COUNT(*)::BIGINT AS games, ` +
    `COALESCE(SUM(CASE WHEN surrendered THEN 1 ELSE 0 END), 0)::BIGINT AS surrenders ` +
    `FROM facts GROUP BY player_id`;
  const allParams = [
    ...accounts.params,
    ...source.params,
    ...playerScope.params,
  ];

  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(sql, bindParams(session, allParams));
    return rows.map((row) => PlayerAggregateRowSchema.parse(row));
  });
}

export async function getSurrenderLeadersFromLake(params: {
  serverId: DiscordGuildId;
  startDate: Date;
  endDate: Date;
  queues?: string[];
  minGames: number;
  limit: number;
}): Promise<SurrenderLeaderRow[]> {
  const aggregates = await fetchPlayerAggregates(params);
  return aggregates
    .filter((row) => row.games >= params.minGames && row.surrenders > 0)
    .map((row) => ({
      playerId: row.player_id,
      playerAlias: row.player_alias,
      discordId: row.discord_id,
      games: row.games,
      surrenders: row.surrenders,
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
  const parsedConfig: unknown = JSON.parse(criteriaConfig);
  const config = z.record(z.string(), z.unknown()).parse(parsedConfig);
  return CompetitionCriteriaSchema.parse({
    type: criteriaType,
    ...config,
  });
}

export async function getMostGamesPlayedCompetitionLeaderboardFromLake(
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
      `Lake proof query supports MOST_GAMES_PLAYED only, got ${criteria.type}`,
    );
  }

  const queueType: CompetitionQueueType = criteria.queue;
  const queues = competitionQueueToStoredQueues(queueType);
  const playerIds: PlayerId[] = competition.participants.map(
    (participant) => participant.playerId,
  );
  const aggregates = await fetchPlayerAggregates({
    serverId: competition.serverId,
    startDate: competition.startDate,
    endDate: competition.endDate ?? new Date(),
    ...(queues === undefined ? {} : { queues: [...queues] }),
    playerIds: [...playerIds],
  });
  const scoreByPlayer = new Map<number, number>(
    aggregates.map((row) => [row.player_id, row.games]),
  );

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
