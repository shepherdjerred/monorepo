import { z } from "zod";
import {
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { runSource } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import {
  buildMatchesSource,
  listParam,
  scalarParam,
  withLakeQueryRetry,
  type BoundParam,
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
>;

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
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const allPuuids = [...new Set(pairs.map((pair) => pair.puuid))];
      const queues = queuePredicate(options.queues);
      const source = buildMatchesSource(files, {
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
      return await runSource({
        source,
        leadingParams: requestedParams,
        trailingParams: windowParams,
        sql:
          `WITH requested(entry_key, puuid) AS (VALUES ${requestedSql}), ` +
          `deduped AS (` +
          `SELECT requested.entry_key, matches.* FROM (${source.sql}) AS matches ` +
          `INNER JOIN requested ON requested.puuid = matches.puuid ` +
          `QUALIFY row_number() OVER (` +
          `PARTITION BY requested.entry_key, matches.match_id ORDER BY matches.puuid) = 1), ` +
          `ranked AS (` +
          `SELECT *, row_number() OVER (` +
          `PARTITION BY entry_key ORDER BY game_creation_at DESC, match_id DESC) AS player_game_rank ` +
          `FROM deduped), scoped AS (SELECT * FROM ranked ${windowClause}) ` +
          `SELECT entry_key, min(champion_name) AS champion_name, count(*)::BIGINT AS games, ` +
          `sum(CASE WHEN win THEN 1 ELSE 0 END)::BIGINT AS wins, ` +
          `sum(kills)::BIGINT AS kills, sum(deaths)::BIGINT AS deaths, ` +
          `sum(assists)::BIGINT AS assists, sum(creep_score)::BIGINT AS creep_score, ` +
          `sum(gold_earned)::BIGINT AS gold_earned, sum(vision_score)::BIGINT AS vision_score, ` +
          `sum(total_damage_dealt_to_champions)::BIGINT AS damage_to_champions, ` +
          `sum(time_played)::BIGINT AS time_played FROM scoped GROUP BY entry_key`,
        schema: ChampionComparisonRowSchema,
      });
    },
  );
}
