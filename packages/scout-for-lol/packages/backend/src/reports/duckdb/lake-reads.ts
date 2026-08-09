import {
  CachedLeaderboardSchema,
  type CachedLeaderboard,
  type CompetitionId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildCompetitionRankHistorySource,
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

const CompetitionRankHistoryRowSchema = z.object({
  calculated_ms: z.union([z.bigint(), z.number()]).transform(Number),
  player_id: z.union([z.bigint(), z.number()]).transform(Number),
  player_name: z.string(),
  score: z.number(),
  rank: z.union([z.bigint(), z.number()]).transform(Number),
});

/**
 * Read the disposable competition_rank_history materialization. Undefined
 * means the current lake predates this source, allowing the API migration
 * path to read authoritative S3 directly; an empty array is a valid built
 * source with no snapshots for this competition.
 */
export async function fetchCompetitionRankHistory(options: {
  competitionId: CompetitionId;
  lakeDir?: string;
}): Promise<CachedLeaderboard[] | undefined> {
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const source = buildCompetitionRankHistorySource(files, {
    sql: "competition_id = ?",
    params: [scalarParam(options.competitionId)],
  });
  if (source === undefined) {
    return undefined;
  }
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `SELECT epoch_ms(calculated_at)::BIGINT AS calculated_ms, player_id, player_name, score, rank FROM (${source.sql}) ORDER BY calculated_at ASC, rank ASC`,
      bindParams(session, source.params),
    );
    const snapshots = new Map<
      number,
      z.infer<typeof CompetitionRankHistoryRowSchema>[]
    >();
    for (const row of rows) {
      const parsed = CompetitionRankHistoryRowSchema.parse(row);
      const bucket = snapshots.get(parsed.calculated_ms) ?? [];
      bucket.push(parsed);
      snapshots.set(parsed.calculated_ms, bucket);
    }
    return [...snapshots.entries()].map(([calculatedMs, entries]) =>
      CachedLeaderboardSchema.parse({
        version: "v1",
        competitionId: options.competitionId,
        calculatedAt: new Date(calculatedMs).toISOString(),
        entries: entries.map((entry) => ({
          playerId: entry.player_id,
          playerName: entry.player_name,
          score: entry.score,
          rank: entry.rank,
        })),
      }),
    );
  });
}
