import { z } from "zod";
import {
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { withPageLakeSession } from "#src/reports/duckdb/consumer/pages/page-session.ts";
import {
  buildMatchesSource,
  listParam,
  scalarParam,
  type BoundParam,
  GAME_CREATED_AT_SQL,
  GAME_CREATED_MS_SQL,
  PLAYED_SECONDS_SQL,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

function queuePredicate(queues: QueueType[] | undefined): {
  sql: string;
  params: BoundParam[];
} {
  return queues === undefined
    ? { sql: "", params: [] }
    : {
        sql: "queue IN (SELECT unnest(?))",
        params: [listParam(queues)],
      };
}

export type ChampionComparisonEntry = {
  entryKey: string;
  puuids: string[];
};

const ChampionComparisonRowSchema = z.object({
  entry_key: z.string(),
  champion_name: z.string(),
  games: LakeIntSchema,
  wins: LakeIntSchema,
  kills: LakeIntSchema,
  deaths: LakeIntSchema,
  assists: LakeIntSchema,
  creep_score: LakeIntSchema,
  gold_earned: LakeIntSchema,
  vision_score: LakeIntSchema,
  damage_to_champions: LakeIntSchema,
  time_played: LakeIntSchema,
});

export type LakeChampionComparisonRow = z.infer<
  typeof ChampionComparisonRowSchema
> & {
  /** The newest games in scope, newest first, at most {@link RECENT_GAMES}. */
  recent: LakeChampionRecentGame[];
};

/** The "last 10" form line on a champion page. */
export const RECENT_GAMES = 10;

const ChampionRecentGameSchema = z.object({
  entry_key: z.string(),
  match_id: RiotMatchIdSchema,
  win: z.boolean(),
  played_at_ms: LakeIntSchema,
});

export type LakeChampionRecentGame = {
  matchId: RiotMatchId;
  win: boolean;
  playedAtMs: number;
};

export async function fetchChampionComparisons(options: {
  championId: number;
  entries: ChampionComparisonEntry[];
  games: PlayerProfileGameWindow;
  queues?: QueueType[];
  lakeDir?: string;
}): Promise<LakeChampionComparisonRow[]> {
  const pairs = options.entries.flatMap((entry) =>
    entry.puuids.map((puuid) => ({ entryKey: entry.entryKey, puuid })),
  );
  if (pairs.length === 0) return [];
  return await withPageLakeSession(options.lakeDir, async (page) => {
    const allPuuids = [...new Set(pairs.map((pair) => pair.puuid))];
    const queues = queuePredicate(options.queues);
    const source = buildMatchesSource(page.files, {
      sql: ["puuid IN (SELECT unnest(?))", "champion_id = ?", queues.sql]
        .filter((part) => part.length > 0)
        .join(" AND "),
      params: [
        listParam(allPuuids),
        scalarParam(options.championId),
        ...queues.params,
      ],
    });
    if (source === undefined) return [];
    const requestedSql = pairs.map(() => "(?, ?)").join(", ");
    const requestedParams = pairs.flatMap((pair) => [
      scalarParam(pair.entryKey),
      scalarParam(pair.puuid),
    ]);
    const windowClause =
      options.games === "all" ? "" : "WHERE player_game_rank <= ?";
    const windowParams =
      options.games === "all" ? [] : [scalarParam(options.games)];
    const scopedSql =
      `WITH requested(entry_key, puuid) AS (VALUES ${requestedSql}), ` +
      `deduped AS (` +
      `SELECT requested.entry_key, matches.* FROM (${source.sql}) AS matches ` +
      `INNER JOIN requested ON requested.puuid = matches.puuid ` +
      `QUALIFY row_number() OVER (` +
      `PARTITION BY requested.entry_key, matches.match_id ORDER BY matches.puuid) = 1), ` +
      `ranked AS (` +
      `SELECT *, row_number() OVER (` +
      `PARTITION BY entry_key ORDER BY ${GAME_CREATED_AT_SQL} DESC, match_id DESC) AS player_game_rank ` +
      `FROM deduped), scoped AS (SELECT * FROM ranked ${windowClause}) `;
    const aggregates = await page.run({
      source,
      leadingParams: requestedParams,
      trailingParams: windowParams,
      sql:
        scopedSql +
        `SELECT entry_key, min(champion_name) AS champion_name, count(*)::BIGINT AS games, ` +
        `sum(CASE WHEN win THEN 1 ELSE 0 END)::BIGINT AS wins, ` +
        `sum(kills)::BIGINT AS kills, sum(deaths)::BIGINT AS deaths, ` +
        `sum(assists)::BIGINT AS assists, sum(creep_score)::BIGINT AS creep_score, ` +
        `sum(gold_earned)::BIGINT AS gold_earned, sum(vision_score)::BIGINT AS vision_score, ` +
        `sum(total_damage_dealt_to_champions)::BIGINT AS damage_to_champions, ` +
        `sum(${PLAYED_SECONDS_SQL})::BIGINT AS time_played FROM scoped GROUP BY entry_key`,
      schema: ChampionComparisonRowSchema,
    });
    const recent = await page.run({
      source,
      leadingParams: requestedParams,
      trailingParams: windowParams,
      sql:
        scopedSql +
        `SELECT entry_key, match_id, win, ${GAME_CREATED_MS_SQL}::BIGINT AS played_at_ms ` +
        `FROM scoped WHERE player_game_rank <= ${RECENT_GAMES.toString()} ` +
        `ORDER BY entry_key, player_game_rank`,
      schema: ChampionRecentGameSchema,
    });
    const recentByEntry = Map.groupBy(recent, (game) => game.entry_key);
    return aggregates.map((aggregate) => ({
      ...aggregate,
      recent: (recentByEntry.get(aggregate.entry_key) ?? []).map((game) => ({
        matchId: game.match_id,
        win: game.win,
        playedAtMs: game.played_at_ms,
      })),
    }));
  });
}
