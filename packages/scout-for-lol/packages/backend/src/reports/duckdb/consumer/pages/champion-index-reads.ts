import { z } from "zod";
import {
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { withPageLakeSession } from "#src/reports/duckdb/consumer/pages/page-session.ts";
import {
  buildMatchesSource,
  listParam,
  scalarParam,
  GAME_CREATED_AT_SQL,
  GAME_CREATED_MS_SQL,
  type BoundParam,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

export type ChampionPageEntry = {
  entryKey: string;
  puuids: string[];
};

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

/**
 * Every champion each entry played inside its newest-N window, split by the
 * position it was played in. One statement in one page session; an entry's
 * accounts are merged and a game seen on two of them counts once.
 */
export async function fetchChampionIndex(options: {
  entries: ChampionPageEntry[];
  games: PlayerProfileGameWindow;
  queues?: QueueType[] | undefined;
  lakeDir?: string | undefined;
}): Promise<LakeChampionIndexRow[]> {
  const pairs = options.entries.flatMap((entry) =>
    entry.puuids.map((puuid) => ({ entryKey: entry.entryKey, puuid })),
  );
  if (pairs.length === 0) return [];
  return await withPageLakeSession(options.lakeDir, async (page) => {
    const queueParams: BoundParam[] =
      options.queues === undefined ? [] : [listParam(options.queues)];
    const source = buildMatchesSource(page.files, {
      sql: [
        "puuid IN (SELECT unnest(?))",
        options.queues === undefined ? "" : "queue IN (SELECT unnest(?))",
      ]
        .filter((part) => part.length > 0)
        .join(" AND "),
      params: [
        listParam([...new Set(pairs.map((pair) => pair.puuid))]),
        ...queueParams,
      ],
    });
    if (source === undefined) return [];
    const windowClause =
      options.games === "all" ? "" : "WHERE player_game_rank <= ?";
    return await page.run({
      source,
      leadingParams: pairs.flatMap((pair) => [
        scalarParam(pair.entryKey),
        scalarParam(pair.puuid),
      ]),
      trailingParams:
        options.games === "all" ? [] : [scalarParam(options.games)],
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
        `FROM deduped), scoped AS (SELECT * FROM ranked ${windowClause}) ` +
        `SELECT entry_key, champion_id, team_position, ` +
        `count(*)::BIGINT AS games, sum(CASE WHEN win THEN 1 ELSE 0 END)::BIGINT AS wins, ` +
        `max(${GAME_CREATED_MS_SQL})::BIGINT AS last_played_ms ` +
        `FROM scoped GROUP BY entry_key, champion_id, team_position ` +
        `ORDER BY entry_key, champion_id, team_position`,
      schema: ChampionIndexRowSchema,
    });
  });
}
