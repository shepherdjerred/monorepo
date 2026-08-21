import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { REMAKE_MAX_DURATION_SECONDS } from "#src/betting/constants.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";

const PredictionHistoryRowSchema = z.object({
  puuid: z.string(),
  match_id: z.string(),
  game_creation_ms: z.union([z.bigint(), z.number()]).transform(Number),
  champion_id: z.union([z.bigint(), z.number()]).transform(Number),
  team_position: z.string(),
  win: z.boolean(),
});

export type LakePredictionHistoryRow = z.infer<
  typeof PredictionHistoryRowSchema
>;

/** Point-in-time same-queue history, capped independently for every player. */
export async function fetchPredictionHistory(options: {
  puuids: string[];
  excludeMatchId: string;
  queue: string;
  beforeMs: number;
  limitPerPlayer: number;
  lakeDir?: string;
  timeoutMs?: number;
}): Promise<LakePredictionHistoryRow[]> {
  if (options.puuids.length === 0) {
    return [];
  }
  const files = await resolveLakeFiles(options.lakeDir ?? resolveLakeDir());
  const source = buildMatchesSource(files, {
    sql: "match_id <> ? AND queue = ? AND end_of_game_result = 'GameComplete' AND epoch_ms(game_creation_at) < ?",
    params: [
      scalarParam(options.excludeMatchId),
      scalarParam(options.queue),
      scalarParam(options.beforeMs),
    ],
  });
  if (source === undefined) {
    return [];
  }
  const sql =
    `WITH history_candidates AS (` +
    `SELECT *, bool_or(game_ended_in_early_surrender OR team_early_surrendered) ` +
    `OVER (PARTITION BY match_id) AS is_remake FROM (${source.sql})` +
    `), decided_history AS (` +
    `SELECT * FROM history_candidates WHERE game_duration_seconds >= ? AND NOT is_remake ` +
    `AND puuid IN (SELECT unnest(?))` +
    `) SELECT puuid, match_id, game_creation_ms, champion_id, team_position, win FROM (` +
    `SELECT puuid, match_id, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ` +
    `champion_id, team_position, win, ` +
    `row_number() OVER (PARTITION BY puuid ORDER BY game_creation_at DESC, match_id DESC) AS history_rank ` +
    `FROM decided_history` +
    `) WHERE history_rank <= ? ORDER BY puuid, game_creation_ms DESC, match_id DESC`;
  const connectionOptions =
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  return await withDuckDBConnection(async (session) => {
    const parameters = [
      ...source.params,
      scalarParam(REMAKE_MAX_DURATION_SECONDS),
      listParam(options.puuids),
      scalarParam(Math.floor(options.limitPerPlayer)),
    ];
    const rows = await session.run(
      sql,
      parameters.map((parameter) =>
        parameter.kind === "list"
          ? session.list(parameter.values)
          : parameter.value,
      ),
    );
    return rows.map((row) => PredictionHistoryRowSchema.parse(row));
  }, connectionOptions);
}
