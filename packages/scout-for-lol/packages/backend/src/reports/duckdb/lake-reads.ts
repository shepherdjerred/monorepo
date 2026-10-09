import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  MATCH_LOADOUT_LAKE_COLUMNS_SQL,
  MATCH_UI_READ_COLUMNS,
  MatchLoadoutLakeRowSchema,
} from "#src/report-lake/loadout.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  listParam,
  scalarParam,
  withLakeQueryRetry,
  type BoundParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

/**
 * Typed row-level reads over the report lake for non-report consumers
 * (AI-review player history, summoner-index backfill). Same safety model as
 * the report compiler: fixed SQL shapes, closed column lists, every runtime
 * value parameter-bound.
 */

/**
 * Bind a lake query's parameters for one session.
 *
 * Exported for `reports/identity.ts`, which runs its own lookups. `execute.ts`
 * still carries a private copy; collapsing the two is a separate cleanup.
 */
export function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): (string | number | ReturnType<DuckDBSession["list"]>)[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

const HistoryGameRowSchema = z.object({
  match_id: RiotMatchIdSchema,
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
  return await withLakeQueryRetry(lakeDir, async (files) => {
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
  return await withLakeQueryRetry(lakeDir, async (files) => {
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
  });
}

const TeamRowSchema = z.object({
  match_id: RiotMatchIdSchema,
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
  matchIds: RiotMatchId[];
  puuids: string[];
  excludePuuid: string;
  lakeDir?: string;
}): Promise<LakeTeamRow[]> {
  if (options.matchIds.length === 0 || options.puuids.length === 0) {
    return [];
  }
  const lakeDir = options.lakeDir ?? resolveLakeDir();
  return await withLakeQueryRetry(lakeDir, async (files) => {
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
  });
}

/** DuckDB returns integer aggregates as BIGINT; normalise to number. */
/**
 * Resolve the lake and build a matches source for one predicate.
 * `undefined` means the lake has no files yet — callers return [].
 */
async function withMatchesSource<T>(
  lakeDir: string | undefined,
  predicate: SqlFragment,
  loadout: readonly string[],
  action: (source: SqlFragment | undefined) => Promise<T>,
): Promise<T> {
  return await withLakeQueryRetry(
    lakeDir ?? resolveLakeDir(),
    async (files) =>
      await action(buildMatchesSource(files, predicate, loadout)),
  );
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
  queues?: QueueType[];
}): SqlFragment {
  const sql = ["puuid IN (SELECT unnest(?))"];
  const params: BoundParam[] = [listParam(options.puuids)];
  if (options.queue !== undefined) {
    sql.push("queue = ?");
    params.push(scalarParam(options.queue));
  }
  if (options.queues !== undefined) {
    sql.push("queue IN (SELECT unnest(?))");
    params.push(listParam(options.queues));
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
const PlayerMatchHistoryRowSchema = z
  .object({
    match_id: RiotMatchIdSchema,
    puuid: z.string(),
    game_creation_ms: LakeIntSchema,
    game_duration_seconds: LakeIntSchema,
    queue: z.string().nullable(),
    queue_id: LakeIntSchema,
    game_mode: z.string(),
    placement: LakeIntSchema.nullable(),
    subteam_placement: LakeIntSchema.nullable(),
    player_subteam_id: LakeIntSchema.nullable(),
    augment_1_id: LakeIntSchema.nullable(),
    augment_2_id: LakeIntSchema.nullable(),
    augment_3_id: LakeIntSchema.nullable(),
    augment_4_id: LakeIntSchema.nullable(),
    augment_5_id: LakeIntSchema.nullable(),
    augment_6_id: LakeIntSchema.nullable(),
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
  })
  .extend(MatchLoadoutLakeRowSchema.shape);

export type LakePlayerMatchHistoryRow = z.infer<
  typeof PlayerMatchHistoryRowSchema
>;

/** One row per match, newest first — `puuid` deduped as described above. */
const DEDUPE_TO_ONE_ROW_PER_MATCH =
  "QUALIFY row_number() OVER (PARTITION BY match_id ORDER BY puuid) = 1";

export type MatchHistoryCursor = {
  gameCreationMs: number;
  matchId: RiotMatchId;
  consumed?: number | undefined;
};

/**
 * Guild-resolved PUUIDs are the authorization boundary (lake has no guild ID).
 * Keyset pagination prevents ingestion mid-scroll from shifting pages.
 */
export async function fetchPlayerMatchHistory(options: {
  puuids: string[];
  limit?: number;
  cursor?: MatchHistoryCursor;
  queue?: string;
  queues?: QueueType[];
  championSearch?: string;
  afterMs?: number;
  lakeDir?: string;
}): Promise<LakePlayerMatchHistoryRow[]> {
  if (options.puuids.length === 0) {
    return [];
  }
  const predicate = playerPredicate(options);
  const clauses = [predicate.sql];
  const params = [...predicate.params];
  if (options.championSearch !== undefined && options.championSearch !== "") {
    clauses.push("strpos(lower(champion_name), lower(?)) > 0");
    params.push(scalarParam(options.championSearch));
  }
  if (options.afterMs !== undefined) {
    clauses.push("epoch_ms(game_creation_at) >= ?");
    params.push(scalarParam(options.afterMs));
  }
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

  return await withMatchesSource(
    options.lakeDir,
    {
      sql: clauses.join(" AND "),
      params,
    },
    MATCH_UI_READ_COLUMNS,
    async (source) => {
      if (source === undefined) {
        return [];
      }
      const limitSql = options.limit === undefined ? "" : "LIMIT ?";
      return await runLakeQuery({
        source,
        sql:
          `SELECT match_id, puuid, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms, ` +
          `game_duration_seconds, queue, queue_id, game_mode, placement, subteam_placement, player_subteam_id, ` +
          `augment_1_id, augment_2_id, augment_3_id, augment_4_id, augment_5_id, augment_6_id, ` +
          `champion_id, champion_name, team_position, team_id, win, kills, deaths, assists, creep_score, ` +
          `gold_earned, total_damage_dealt_to_champions, vision_score, time_played, ` +
          `${MATCH_LOADOUT_LAKE_COLUMNS_SQL} ` +
          `FROM (${source.sql}) ${DEDUPE_TO_ONE_ROW_PER_MATCH} ` +
          `ORDER BY game_creation_ms DESC, match_id DESC ${limitSql}`,
        extraParams:
          options.limit === undefined
            ? []
            : [scalarParam(Math.floor(options.limit))],
        schema: PlayerMatchHistoryRowSchema,
      });
    },
  );
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
  gold_earned: LakeIntSchema.default(0),
  vision_score: LakeIntSchema.default(0),
  damage_to_champions: LakeIntSchema.default(0),
  team_position: z.string().nullable().default(null),
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
  queues?: QueueType[];
  games?: PlayerProfileGameWindow;
  lakeDir?: string;
}): Promise<LakeChampionPoolRow[]> {
  if (options.puuids.length === 0) {
    return [];
  }
  return await withMatchesSource(
    options.lakeDir,
    playerPredicate(options),
    [],
    async (source) => {
      if (source === undefined) {
        return [];
      }
      const limitSql =
        options.games === 20 || options.games === 50 ? "LIMIT ?" : "";
      return await runLakeQuery({
        source,
        sql:
          `WITH player_matches AS (` +
          `SELECT * FROM (${source.sql}) ${DEDUPE_TO_ONE_ROW_PER_MATCH} ` +
          `ORDER BY game_creation_at DESC, match_id DESC ${limitSql}) ` +
          `SELECT champion_id, champion_name, count(*) AS games, ` +
          `sum(CASE WHEN win THEN 1 ELSE 0 END)::BIGINT AS wins, ` +
          `sum(kills)::BIGINT AS kills, sum(deaths)::BIGINT AS deaths, ` +
          `sum(assists)::BIGINT AS assists, sum(creep_score)::BIGINT AS creep_score, ` +
          `sum(time_played)::BIGINT AS time_played, ` +
          `sum(COALESCE(gold_earned, 0))::BIGINT AS gold_earned, ` +
          `sum(COALESCE(vision_score, 0))::BIGINT AS vision_score, ` +
          `sum(COALESCE(total_damage_dealt_to_champions, 0))::BIGINT AS damage_to_champions, ` +
          `mode(CASE WHEN upper(trim(team_position)) IN ('', 'INVALID') THEN NULL ELSE team_position END) AS team_position ` +
          `FROM player_matches ` +
          `GROUP BY champion_id, champion_name ORDER BY games DESC, champion_name ASC`,
        extraParams:
          options.games === 20 || options.games === 50
            ? [scalarParam(options.games)]
            : [],
        schema: ChampionPoolRowSchema,
      });
    },
  );
}

const TeamTotalsRowSchema = z.object({
  match_id: RiotMatchIdSchema,
  team_id: LakeIntSchema,
  team_kills: LakeIntSchema,
  team_damage_to_champions: LakeIntSchema,
});

export type LakeTeamTotalsRow = z.infer<typeof TeamTotalsRowSchema>;

/**
 * Team-relative denominators must filter by match only, never player PUUID;
 * otherwise every one-player team has a false participation of 100%.
 */
export async function fetchTeamTotalsForMatches(options: {
  matchIds: RiotMatchId[];
  lakeDir?: string;
}): Promise<LakeTeamTotalsRow[]> {
  if (options.matchIds.length === 0) {
    return [];
  }
  return await withMatchesSource(
    options.lakeDir,
    {
      sql: "match_id IN (SELECT unnest(?))",
      params: [listParam(options.matchIds)],
    },
    [],
    async (source) => {
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
    },
  );
}
