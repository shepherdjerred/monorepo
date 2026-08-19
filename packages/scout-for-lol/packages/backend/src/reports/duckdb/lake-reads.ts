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
  type SqlFragment,
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

const QueueHistoryGameRowSchema = HistoryGameRowSchema.extend({
  puuid: z.string(),
});

export type QueueHistoryGameRow = z.infer<typeof QueueHistoryGameRowSchema>;

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

/** One query returning up to `limitPerPlayer` same-queue matches for every
 * requested PUUID. The window is per player; a globally applied LIMIT would
 * let one active player's history crowd every other tracked player out. */
export async function fetchRecentQueueGamesForPuuids(options: {
  puuids: string[];
  queue: string;
  excludeMatchId: string;
  limitPerPlayer: number;
  lakeDir?: string;
  timeoutMs?: number;
}): Promise<QueueHistoryGameRow[]> {
  if (options.puuids.length === 0) return [];
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);
  const source = buildMatchesSource(files, {
    sql: "puuid IN (SELECT unnest(?)) AND match_id <> ? AND queue = ?",
    params: [
      listParam(options.puuids),
      scalarParam(options.excludeMatchId),
      scalarParam(options.queue),
    ],
  });
  if (source === undefined) return [];
  const sql =
    `WITH ranked_history AS (` +
    `SELECT puuid, match_id, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ` +
    `champion_name, team_position, queue, win, kills, deaths, assists, ` +
    `creep_score, game_duration_seconds, team_id, ` +
    `row_number() OVER (PARTITION BY puuid ORDER BY game_creation_at DESC) AS history_rank ` +
    `FROM (${source.sql})) ` +
    `SELECT puuid, match_id, game_creation_ms, champion_name, team_position, queue, ` +
    `win, kills, deaths, assists, creep_score, game_duration_seconds, team_id ` +
    `FROM ranked_history WHERE history_rank <= ? ORDER BY puuid, game_creation_ms DESC`;
  const connectionOptions =
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      sql,
      bindParams(session, [
        ...source.params,
        scalarParam(Math.floor(options.limitPerPlayer)),
      ]),
    );
    return rows.map((row) => QueueHistoryGameRowSchema.parse(row));
  }, connectionOptions);
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

/** DuckDB returns integer aggregates as BIGINT; normalise to number. */
const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

/**
 * Resolve the lake and build a matches source for one predicate.
 * `undefined` means the lake has no files yet — callers return [].
 */
async function matchesSourceFor(
  lakeDir: string | undefined,
  predicate: SqlFragment,
): Promise<SqlFragment | undefined> {
  const files = await resolveLakeFiles(lakeDir ?? resolveLakeDir());
  return buildMatchesSource(files, predicate);
}

/** Run `sql` over a built source and parse every row with `schema`. */
async function runLakeQuery<T>(options: {
  source: SqlFragment;
  sql: string;
  extraParams?: BoundParam[];
  schema: z.ZodType<T>;
}): Promise<T[]> {
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      options.sql,
      bindParams(session, [
        ...options.source.params,
        ...(options.extraParams ?? []),
      ]),
    );
    return rows.map((row) => options.schema.parse(row));
  });
}

/**
 * `puuid IN (…)` plus an optional queue filter — the predicate shared by every
 * per-player profile read. The puuid list is the caller's whole authorization
 * surface; see {@link fetchPlayerMatchHistory}.
 */
function playerPredicate(options: {
  puuids: string[];
  queue?: string;
}): SqlFragment {
  const sql = ["puuid IN (SELECT unnest(?))"];
  const params: BoundParam[] = [listParam(options.puuids)];
  if (options.queue !== undefined) {
    sql.push("queue = ?");
    params.push(scalarParam(options.queue));
  }
  return { sql: sql.join(" AND "), params };
}

/**
 * One match as played by a tracked player, newest first.
 *
 * Deduped to one row per `match_id`: a Scout `Player` owns several `Account`s,
 * and `mergePlayers` can leave one Player holding two PUUIDs that appear in the
 * same game. Without the QUALIFY that match would be listed — and counted in
 * every aggregate below — twice.
 */
const PlayerMatchHistoryRowSchema = z.object({
  match_id: z.string(),
  puuid: z.string(),
  game_creation_ms: LakeIntSchema,
  game_duration_seconds: LakeIntSchema,
  queue: z.string().nullable(),
  queue_id: LakeIntSchema,
  champion_id: LakeIntSchema,
  champion_name: z.string(),
  team_position: z.string(),
  team_id: LakeIntSchema,
  win: z.boolean(),
  kills: LakeIntSchema,
  deaths: LakeIntSchema,
  assists: LakeIntSchema,
  creep_score: LakeIntSchema,
  gold_earned: LakeIntSchema,
  total_damage_dealt_to_champions: LakeIntSchema,
  vision_score: LakeIntSchema,
  time_played: LakeIntSchema,
});

export type LakePlayerMatchHistoryRow = z.infer<
  typeof PlayerMatchHistoryRowSchema
>;

/** One row per match, newest first — `puuid` deduped as described above. */
const DEDUPE_TO_ONE_ROW_PER_MATCH =
  "QUALIFY row_number() OVER (PARTITION BY match_id ORDER BY puuid) = 1";

export type MatchHistoryCursor = {
  gameCreationMs: number;
  matchId: string;
};

/**
 * A page of a player's match history across ALL of their accounts.
 *
 * `puuids` is the caller's whole authorization surface — the matches parquet
 * carries no `server_id`, so this function cannot tell a guild's account from
 * anyone else's. Callers must resolve the puuid list within the requesting
 * guild; see `player.router.ts`.
 *
 * Keyset pagination on `(game_creation_at, match_id)` rather than OFFSET, so a
 * match ingested mid-scroll cannot shift the page boundary and duplicate a row.
 */
export async function fetchPlayerMatchHistory(options: {
  puuids: string[];
  limit: number;
  cursor?: MatchHistoryCursor;
  queue?: string;
  lakeDir?: string;
}): Promise<LakePlayerMatchHistoryRow[]> {
  if (options.puuids.length === 0) {
    return [];
  }
  const predicate = playerPredicate(options);
  const clauses = [predicate.sql];
  const params = [...predicate.params];
  if (options.cursor !== undefined) {
    clauses.push(
      "(epoch_ms(game_creation_at) < ? OR (epoch_ms(game_creation_at) = ? AND match_id < ?))",
    );
    params.push(
      scalarParam(options.cursor.gameCreationMs),
      scalarParam(options.cursor.gameCreationMs),
      scalarParam(options.cursor.matchId),
    );
  }

  const source = await matchesSourceFor(options.lakeDir, {
    sql: clauses.join(" AND "),
    params,
  });
  if (source === undefined) {
    return [];
  }
  return await runLakeQuery({
    source,
    sql:
      `SELECT match_id, puuid, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ` +
      `game_duration_seconds, queue, queue_id, champion_id, champion_name, ` +
      `team_position, team_id, win, kills, deaths, assists, creep_score, ` +
      `gold_earned, total_damage_dealt_to_champions, vision_score, time_played ` +
      `FROM (${source.sql}) ${DEDUPE_TO_ONE_ROW_PER_MATCH} ` +
      `ORDER BY game_creation_ms DESC, match_id DESC LIMIT ?`,
    extraParams: [scalarParam(Math.floor(options.limit))],
    schema: PlayerMatchHistoryRowSchema,
  });
}

const ChampionPoolRowSchema = z.object({
  champion_id: LakeIntSchema,
  champion_name: z.string(),
  games: LakeIntSchema,
  wins: LakeIntSchema,
  kills: LakeIntSchema,
  deaths: LakeIntSchema,
  assists: LakeIntSchema,
  creep_score: LakeIntSchema,
  time_played: LakeIntSchema,
});

export type LakeChampionPoolRow = z.infer<typeof ChampionPoolRowSchema>;

/**
 * Per-champion totals across all of a player's accounts, most-played first.
 *
 * Returns raw totals, not rates: the caller derives win rate / KDA / CS-min so
 * that minimum-sample suppression is decided once, in one place, against the
 * `games` count rather than re-derived per metric.
 *
 * Same authorization contract as {@link fetchPlayerMatchHistory}.
 */
export async function fetchPlayerChampionPool(options: {
  puuids: string[];
  queue?: string;
  lakeDir?: string;
}): Promise<LakeChampionPoolRow[]> {
  if (options.puuids.length === 0) {
    return [];
  }
  const source = await matchesSourceFor(
    options.lakeDir,
    playerPredicate(options),
  );
  if (source === undefined) {
    return [];
  }
  return await runLakeQuery({
    source,
    sql:
      `SELECT champion_id, champion_name, count(*) AS games, ` +
      `sum(CASE WHEN win THEN 1 ELSE 0 END)::BIGINT AS wins, ` +
      `sum(kills)::BIGINT AS kills, sum(deaths)::BIGINT AS deaths, ` +
      `sum(assists)::BIGINT AS assists, sum(creep_score)::BIGINT AS creep_score, ` +
      `sum(time_played)::BIGINT AS time_played ` +
      `FROM (SELECT * FROM (${source.sql}) ${DEDUPE_TO_ONE_ROW_PER_MATCH}) ` +
      `GROUP BY champion_id, champion_name ORDER BY games DESC, champion_name ASC`,
    schema: ChampionPoolRowSchema,
  });
}

const TeamTotalsRowSchema = z.object({
  match_id: z.string(),
  team_id: LakeIntSchema,
  team_kills: LakeIntSchema,
  team_damage_to_champions: LakeIntSchema,
});

export type LakeTeamTotalsRow = z.infer<typeof TeamTotalsRowSchema>;

/**
 * Per-team kill and damage totals for the given matches — the denominators for
 * kill participation and damage share.
 *
 * This deliberately filters on `match_id` ONLY, never on the player's puuid.
 * The source predicate is pushed down into the parquet scan, so a puuid-filtered
 * source contains just that one participant: summing it would yield the player's
 * own kills as the "team" total and a participation of exactly 1.0 every game.
 * Filtering by match alone is what makes all ten participants visible.
 */
export async function fetchTeamTotalsForMatches(options: {
  matchIds: string[];
  lakeDir?: string;
}): Promise<LakeTeamTotalsRow[]> {
  if (options.matchIds.length === 0) {
    return [];
  }
  const source = await matchesSourceFor(options.lakeDir, {
    sql: "match_id IN (SELECT unnest(?))",
    params: [listParam(options.matchIds)],
  });
  if (source === undefined) {
    return [];
  }
  return await runLakeQuery({
    source,
    sql:
      `SELECT match_id, team_id, sum(kills)::BIGINT AS team_kills, ` +
      `sum(total_damage_dealt_to_champions)::BIGINT AS team_damage_to_champions ` +
      `FROM (${source.sql}) GROUP BY match_id, team_id`,
    schema: TeamTotalsRowSchema,
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
