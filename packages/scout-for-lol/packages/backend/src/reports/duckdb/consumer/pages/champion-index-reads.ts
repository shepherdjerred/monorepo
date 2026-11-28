import { z } from "zod";
import {
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import {
  withLakePage,
  type LakePage,
} from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/lake/statement.ts";
import {
  entryAccountPairs,
  entryGamesSource,
  gameWindow,
  rankedEntryGames,
  type ChampionPageEntry,
} from "#src/reports/duckdb/consumer/pages/ranked-entry-games.ts";
import {
  GAME_CREATED_MS_SQL,
  scalarParam,
  type BoundParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const ChampionIndexRowSchema = z.object({
  entry_key: z.string(),
  champion_id: LakeIntSchema,
  team_position: z.string(),
  games: LakeIntSchema,
  wins: LakeIntSchema,
  last_played_ms: LakeIntSchema,
});

/** Games, wins and the last game for one person on one champion in one position. */
export type LakeChampionIndexRow = z.infer<typeof ChampionIndexRowSchema>;

type ChampionIndexReadOptions = {
  entries: ChampionPageEntry[];
  games: PlayerProfileGameWindow;
  queues?: QueueType[] | undefined;
  /** Only this champion's games. */
  championId?: number | undefined;
  /** Only games created at or after this time, in epoch milliseconds. */
  sinceMs?: number | undefined;
};

function narrowing(options: ChampionIndexReadOptions): SqlFragment | undefined {
  const clauses: string[] = [];
  const params: BoundParam[] = [];
  if (options.championId !== undefined) {
    clauses.push("champion_id = ?");
    params.push(scalarParam(options.championId));
  }
  if (options.sinceMs !== undefined) {
    clauses.push(`${GAME_CREATED_MS_SQL} >= ?`);
    params.push(scalarParam(options.sinceMs));
  }
  return clauses.length === 0
    ? undefined
    : { sql: clauses.join(" AND "), params };
}

/**
 * Every champion each entry played inside its newest-N window, split by the
 * position it was played in, on the caller's lake page. An entry's accounts
 * are merged and a game seen on two of them counts once. `championId` and
 * `sinceMs` narrow the games before the window ranks them.
 */
async function readChampionIndex(
  page: LakePage,
  options: ChampionIndexReadOptions,
): Promise<LakeChampionIndexRow[]> {
  const pairs = entryAccountPairs(options.entries);
  if (pairs.length === 0) return [];
  const extra = narrowing(options);
  const source = entryGamesSource(page.files, {
    pairs,
    queues: options.queues,
    ...(extra === undefined ? {} : { extra }),
  });
  if (source === undefined) return [];
  const ranked = rankedEntryGames(source, pairs);
  const window = gameWindow(options.games);
  return await runSource({
    session: page.session,
    source,
    leadingParams: ranked.leadingParams,
    trailingParams: window.params,
    sql:
      `${ranked.sql}, scoped AS (SELECT * FROM ranked ${window.where}) ` +
      `SELECT entry_key, champion_id, team_position, ` +
      `count(*)::BIGINT AS games, sum(CASE WHEN win THEN 1 ELSE 0 END)::BIGINT AS wins, ` +
      `max(${GAME_CREATED_MS_SQL})::BIGINT AS last_played_ms ` +
      `FROM scoped GROUP BY entry_key, champion_id, team_position ` +
      `ORDER BY entry_key, champion_id, team_position`,
    schema: ChampionIndexRowSchema,
  });
}

/** {@link readChampionIndex} on a lake page of its own. */
export async function fetchChampionIndex(
  options: ChampionIndexReadOptions & { lakeDir?: string | undefined },
): Promise<LakeChampionIndexRow[]> {
  return entryAccountPairs(options.entries).length === 0
    ? []
    : await withLakePage(
        options.lakeDir,
        async (page) => await readChampionIndex(page, options),
      );
}
