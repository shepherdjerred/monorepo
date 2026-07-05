import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  buildPrematchSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
} from "#src/reports/duckdb/lake.ts";

/**
 * Typed row-level reads over the report lake for non-report consumers
 * (AI-review player history, summoner-index backfill). Same safety model as
 * the report compiler: fixed SQL shapes, closed column lists, every runtime
 * value parameter-bound.
 */

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): (string | number | ReturnType<DuckDBSession["list"]>)[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

const HistoryGameRowSchema = z.object({
  match_id: z.string(),
  game_creation_ms: z.union([z.bigint(), z.number()]).transform(Number),
  champion_name: z.string(),
  team_position: z.string(),
  queue: z.string().nullable(),
  win: z.boolean(),
  kills: z.union([z.bigint(), z.number()]).transform(Number),
  deaths: z.union([z.bigint(), z.number()]).transform(Number),
  assists: z.union([z.bigint(), z.number()]).transform(Number),
  creep_score: z.union([z.bigint(), z.number()]).transform(Number),
  game_duration_seconds: z.union([z.bigint(), z.number()]).transform(Number),
  team_id: z.union([z.bigint(), z.number()]).transform(Number),
});

export type LakeHistoryGameRow = z.infer<typeof HistoryGameRowSchema>;

/**
 * The most recent games (newest first) for any of the given PUUIDs,
 * excluding one match id (the game currently under review). Reads parquet ∪
 * staging, so a game is visible seconds after ingest.
 */
export async function fetchRecentGamesForPuuids(options: {
  puuids: string[];
  excludeMatchId: string;
  limit: number;
  lakeDir?: string;
}): Promise<LakeHistoryGameRow[]> {
  if (options.puuids.length === 0) {
    return [];
  }
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const source = buildMatchesSource(files, {
    sql: "puuid IN (SELECT unnest(?)) AND match_id <> ?",
    params: [listParam(options.puuids), scalarParam(options.excludeMatchId)],
  });
  if (source === undefined) {
    return [];
  }
  const sql =
    `SELECT match_id, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ` +
    `champion_name, team_position, queue, win, kills, deaths, assists, ` +
    `creep_score, game_duration_seconds, team_id FROM (${source.sql}) ` +
    `ORDER BY game_creation_ms DESC LIMIT ?`;
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      sql,
      bindParams(session, [
        ...source.params,
        scalarParam(Math.floor(options.limit)),
      ]),
    );
    return rows.map((row) => HistoryGameRowSchema.parse(row));
  });
}

const TeamRowSchema = z.object({
  match_id: z.string(),
  team_id: z.union([z.bigint(), z.number()]).transform(Number),
  win: z.boolean(),
  puuid: z.string(),
});

export type LakeTeamRow = z.infer<typeof TeamRowSchema>;

/**
 * Participant rows for the given matches restricted to the given PUUIDs
 * (e.g. all tracked accounts of one server), excluding one PUUID (the
 * reviewed player). Team filtering happens in the caller.
 */
export async function fetchTeamRowsForMatches(options: {
  matchIds: string[];
  puuids: string[];
  excludePuuid: string;
  lakeDir?: string;
}): Promise<LakeTeamRow[]> {
  if (options.matchIds.length === 0 || options.puuids.length === 0) {
    return [];
  }
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const source = buildMatchesSource(files, {
    sql: "match_id IN (SELECT unnest(?)) AND puuid IN (SELECT unnest(?)) AND puuid <> ?",
    params: [
      listParam(options.matchIds),
      listParam(options.puuids),
      scalarParam(options.excludePuuid),
    ],
  });
  if (source === undefined) {
    return [];
  }
  const sql = `SELECT match_id, team_id, win, puuid FROM (${source.sql})`;
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(sql, bindParams(session, source.params));
    return rows.map((row) => TeamRowSchema.parse(row));
  });
}

const PrematchIdentityRowSchema = z.object({
  puuid: z.string(),
  riot_id: z.string(),
});

export type LakePrematchIdentityRow = z.infer<typeof PrematchIdentityRowSchema>;

/**
 * Distinct (puuid, riot_id) pairs from prematch observations — the
 * summoner-index backfill source. Returns [] before the first compaction
 * (fail-soft: the backfill is idempotent and re-runs on next startup).
 */
export async function fetchDistinctPrematchIdentities(
  options: {
    lakeDir?: string;
  } = {},
): Promise<LakePrematchIdentityRow[]> {
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const source = buildPrematchSource(files, { sql: "", params: [] });
  if (source === undefined) {
    return [];
  }
  const sql = `SELECT DISTINCT puuid, riot_id FROM (${source.sql})`;
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(sql, bindParams(session, source.params));
    return rows.map((row) => PrematchIdentityRowSchema.parse(row));
  });
}
