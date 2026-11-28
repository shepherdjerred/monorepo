import type { LeaguePuuid, QueueType } from "@scout-for-lol/data";
import {
  buildMatchesSource,
  listParam,
  scalarParam,
  GAME_CREATED_AT_SQL,
  type BoundParam,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

/** One page entry: a person, with every account whose games count as theirs. */
export type ChampionPageEntry = {
  entryKey: string;
  puuids: LeaguePuuid[];
};

export type EntryAccountPair = { entryKey: string; puuid: LeaguePuuid };

export function entryAccountPairs(
  entries: readonly ChampionPageEntry[],
): EntryAccountPair[] {
  return entries.flatMap((entry) =>
    entry.puuids.map((puuid) => ({ entryKey: entry.entryKey, puuid })),
  );
}

/** The entries' participant rows, narrowed by `extra` and the queue selection. */
export function entryGamesSource(
  files: LakeFiles,
  options: {
    pairs: readonly EntryAccountPair[];
    queues?: QueueType[] | undefined;
    extra?: SqlFragment;
    /** Loadout columns to read; a read names the ones it uses. */
    loadout?: readonly string[];
  },
): SqlFragment | undefined {
  const extra = options.extra ?? { sql: "", params: [] };
  const queues: SqlFragment =
    options.queues === undefined
      ? { sql: "", params: [] }
      : {
          sql: "queue IN (SELECT unnest(?))",
          params: [listParam(options.queues)],
        };
  return buildMatchesSource(
    files,
    {
      sql: ["puuid IN (SELECT unnest(?))", extra.sql, queues.sql]
        .filter((part) => part.length > 0)
        .join(" AND "),
      params: [
        listParam([...new Set(options.pairs.map((pair) => pair.puuid))]),
        ...extra.params,
        ...queues.params,
      ],
    },
    options.loadout,
  );
}

/**
 * The common table expressions of a champion page: each entry's games from
 * `source` with accounts merged (a game on two accounts counts once), ranked
 * newest first per entry as `player_game_rank`. The caller continues the
 * `WITH` list or selects from `ranked`, and binds `leadingParams` first.
 */
export function rankedEntryGames(
  source: SqlFragment,
  pairs: readonly EntryAccountPair[],
): { sql: string; leadingParams: BoundParam[] } {
  return {
    sql:
      `WITH requested(entry_key, puuid) AS (VALUES ${pairs.map(() => "(?, ?)").join(", ")}), ` +
      `deduped AS (` +
      `SELECT requested.entry_key, matches.* FROM (${source.sql}) AS matches ` +
      `INNER JOIN requested ON requested.puuid = matches.puuid ` +
      `QUALIFY row_number() OVER (` +
      `PARTITION BY requested.entry_key, matches.match_id ORDER BY matches.puuid) = 1), ` +
      `ranked AS (` +
      `SELECT *, row_number() OVER (` +
      `PARTITION BY entry_key ORDER BY ${GAME_CREATED_AT_SQL} DESC, match_id DESC) AS player_game_rank ` +
      `FROM deduped)`,
    leadingParams: pairs.flatMap((pair) => [
      scalarParam(pair.entryKey),
      scalarParam(pair.puuid),
    ]),
  };
}

/** `WHERE player_game_rank <= ?` for a newest-N window; nothing for all games. */
export function gameWindow(games: number | "all"): {
  where: string;
  params: BoundParam[];
} {
  return games === "all"
    ? { where: "", params: [] }
    : { where: "WHERE player_game_rank <= ?", params: [scalarParam(games)] };
}
