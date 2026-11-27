import { z } from "zod";
import {
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/lake/statement.ts";
import {
  entryAccountPairs,
  entryGamesSource,
  gameWindow,
  rankedEntryGames,
  type ChampionPageEntry,
} from "#src/reports/duckdb/consumer/pages/ranked-entry-games.ts";
import {
  scalarParam,
  GAME_CREATED_MS_SQL,
  PLAYED_SECONDS_SQL,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

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
  entries: ChampionPageEntry[];
  games: PlayerProfileGameWindow;
  queues?: QueueType[];
  lakeDir?: string;
}): Promise<LakeChampionComparisonRow[]> {
  const pairs = entryAccountPairs(options.entries);
  if (pairs.length === 0) return [];
  return await withLakePage(options.lakeDir, async (page) => {
    const source = entryGamesSource(page.files, {
      pairs,
      queues: options.queues,
      extra: {
        sql: "champion_id = ?",
        params: [scalarParam(options.championId)],
      },
    });
    if (source === undefined) return [];
    const ranked = rankedEntryGames(source, pairs);
    const window = gameWindow(options.games);
    const scopedSql = `${ranked.sql}, scoped AS (SELECT * FROM ranked ${window.where}) `;
    const requestedParams = ranked.leadingParams;
    const windowParams = window.params;
    const aggregates = await runSource({
      session: page.session,
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
    const recent = await runSource({
      session: page.session,
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
