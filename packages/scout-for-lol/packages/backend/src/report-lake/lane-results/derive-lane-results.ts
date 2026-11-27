import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  MATCH_LAKE_COLUMNS,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "@scout-for-lol/data";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { copyNdjsonToParquet } from "#src/report-lake/parquet/copy-ndjson.ts";
import { duckDbEmptySelect, lakeTimestamp } from "#src/report-lake/schema.ts";
import {
  LANE_RESULT_LAKE_COLUMNS,
  LANE_RESULTS_TABLE,
} from "#src/report-lake/lane-results/lane-result-columns.ts";
import {
  laneResultRows,
  type LaneParticipant,
} from "#src/report-lake/lane-results/lane-result-rows.ts";
import {
  LaneDeltaFrameSchema,
  MatchParticipantRowSchema,
  TIMELINE_CHECKPOINT_WINDOW_MS,
  type LaneDeltaFrame,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildUnionSource,
  GAME_CREATED_MS_SQL,
  listParam,
  scalarParam,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import type { DuckDBSession } from "#src/reports/duckdb/instance.ts";
import { withMaintenanceDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { LANE_DELTA_CHECKPOINT_MS } from "#src/reports/lanes/role-matchups.ts";

/** The lake files a lane-result derivation reads. */
export type LaneResultInputs = Pick<
  LakeFiles,
  | "matchesParquet"
  | "matchesStaging"
  | "timelineParticipantFramesParquet"
  | "timelineParticipantFramesStaging"
  | "timelineCoverageParquet"
  | "timelineCoverageStaging"
>;

/** Which matches to derive: every match, or those a fold's staged rows touch. */
export type LaneResultScope = "all" | readonly string[];

async function globTable(buildDir: string, table: string): Promise<string[]> {
  const files = await Array.fromAsync(
    new Bun.Glob(`${table}/**/*.parquet`).scan({
      cwd: buildDir,
      absolute: true,
    }),
  );
  return files.toSorted();
}

/**
 * A candidate build's own match and timeline Parquet. A fold has already
 * written its staged rows into the build as fold files, and a rebuild has
 * written everything, so neither reads staging.
 */
export async function buildDirLaneResultInputs(
  buildDir: string,
): Promise<LaneResultInputs> {
  return {
    matchesParquet: await globTable(buildDir, "matches"),
    matchesStaging: [],
    timelineParticipantFramesParquet: await globTable(
      buildDir,
      "timeline_participant_frames",
    ),
    timelineParticipantFramesStaging: [],
    timelineCoverageParquet: await globTable(buildDir, "timeline_coverage"),
    timelineCoverageStaging: [],
  };
}

/** The participant columns a lane result reads, plus the dedupe key's. */
const PARTICIPANT_COLUMNS = {
  match_id: MATCH_LAKE_COLUMNS.match_id,
  month: MATCH_LAKE_COLUMNS.month,
  puuid: MATCH_LAKE_COLUMNS.puuid,
  participant_id: MATCH_LAKE_COLUMNS.participant_id,
  team_id: MATCH_LAKE_COLUMNS.team_id,
  champion_id: MATCH_LAKE_COLUMNS.champion_id,
  team_position: MATCH_LAKE_COLUMNS.team_position,
  queue: MATCH_LAKE_COLUMNS.queue,
  queue_id: MATCH_LAKE_COLUMNS.queue_id,
  game_mode: MATCH_LAKE_COLUMNS.game_mode,
  game_type: MATCH_LAKE_COLUMNS.game_type,
  map_id: MATCH_LAKE_COLUMNS.map_id,
  win: MATCH_LAKE_COLUMNS.win,
  game_creation_at: MATCH_LAKE_COLUMNS.game_creation_at,
  game_start_at: MATCH_LAKE_COLUMNS.game_start_at,
} as const;

/** The frame columns the checkpoint reads, plus the dedupe key's. */
const FRAME_COLUMNS = {
  match_id: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.match_id,
  frame_index: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.frame_index,
  participant_id: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.participant_id,
  frame_timestamp_ms:
    TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.frame_timestamp_ms,
  total_gold: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.total_gold,
  minions_killed: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.minions_killed,
  jungle_minions_killed:
    TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.jungle_minions_killed,
  xp: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS.xp,
} as const;

const LaneParticipantSchema = MatchParticipantRowSchema.pick({
  match_id: true,
  puuid: true,
  participant_id: true,
  team_id: true,
  champion_id: true,
  team_position: true,
  queue: true,
  queue_id: true,
  game_mode: true,
  game_type: true,
  map_id: true,
  win: true,
}).extend({
  month: z.string(),
  game_created_ms: z.union([z.bigint(), z.number()]).transform(Number),
});

const MatchFrameSchema = LaneDeltaFrameSchema.extend({ match_id: z.string() });
const MatchIdRowSchema = z.object({ match_id: z.string() });
const MonthRowSchema = z.object({ month: z.string() });

const TEMP_PARTICIPANTS = "lane_result_participants";
const TEMP_FRAMES = "lane_result_frames";
const TEMP_TIMELINES = "lane_result_timelines";

function matchPredicate(scope: LaneResultScope): SqlFragment {
  return scope === "all"
    ? { sql: "", params: [] }
    : {
        sql: "match_id IN (SELECT unnest(?))",
        params: [listParam([...scope])],
      };
}

function andPredicate(left: SqlFragment, right: SqlFragment): SqlFragment {
  if (left.sql.length === 0) return right;
  return {
    sql: `${left.sql} AND ${right.sql}`,
    params: [...left.params, ...right.params],
  };
}

/**
 * A table with no files has no source; selecting from a typed empty relation
 * instead gives its temp table the same columns.
 */
async function materialize(
  session: DuckDBSession,
  table: string,
  input: {
    source: SqlFragment | undefined;
    columns: Record<string, DuckDbColumnType>;
    select: (from: string) => string;
  },
): Promise<void> {
  const source = input.source ?? {
    sql: duckDbEmptySelect(input.columns),
    params: [],
  };
  await session.run(
    `CREATE TEMP TABLE ${table} AS ${input.select(`(${source.sql})`)}`,
    bindParams(session, source.params),
  );
}

/**
 * Stage the scope's participant rows, 15:00 checkpoint frames and timeline
 * presence in temp tables, each read once.
 *
 * The checkpoint is the app's (`fetchTimelineCheckpointFrames`): the first
 * frame stamped at or after 15:00 and before 16:00, per match. Riot stamps
 * the 15:00 frame just past the minute (about 900303 ms), and a game that
 * ended before 15:00 has no frame in that window, so no checkpoint.
 */
async function stageInputs(
  session: DuckDBSession,
  inputs: LaneResultInputs,
  scope: LaneResultScope,
): Promise<void> {
  const byMatch = matchPredicate(scope);
  await materialize(session, TEMP_PARTICIPANTS, {
    source: buildUnionSource({
      parquetFiles: inputs.matchesParquet,
      stagingFiles: inputs.matchesStaging,
      columns: PARTICIPANT_COLUMNS,
      dedupe: "matches",
      predicate: byMatch,
    }),
    columns: PARTICIPANT_COLUMNS,
    select: (from) =>
      `SELECT match_id, month, puuid, participant_id, team_id, champion_id, team_position, queue, queue_id, game_mode, game_type, map_id, win, ${GAME_CREATED_MS_SQL}::BIGINT AS game_created_ms FROM ${from}`,
  });
  await materialize(session, TEMP_FRAMES, {
    source: buildUnionSource({
      parquetFiles: inputs.timelineParticipantFramesParquet,
      stagingFiles: inputs.timelineParticipantFramesStaging,
      columns: FRAME_COLUMNS,
      dedupe: "timeline-participant-frames",
      predicate: andPredicate(byMatch, {
        sql: "frame_timestamp_ms >= ? AND frame_timestamp_ms < ?",
        params: [
          scalarParam(LANE_DELTA_CHECKPOINT_MS),
          scalarParam(LANE_DELTA_CHECKPOINT_MS + TIMELINE_CHECKPOINT_WINDOW_MS),
        ],
      }),
    }),
    columns: FRAME_COLUMNS,
    select: (from) =>
      `SELECT match_id, participant_id, frame_timestamp_ms, total_gold, minions_killed, jungle_minions_killed, xp FROM ${from} QUALIFY frame_timestamp_ms = min(frame_timestamp_ms) OVER (PARTITION BY match_id)`,
  });
  const coverageColumns = { match_id: TIMELINE_COVERAGE_LAKE_COLUMNS.match_id };
  await materialize(session, TEMP_TIMELINES, {
    source: buildUnionSource({
      parquetFiles: inputs.timelineCoverageParquet,
      stagingFiles: inputs.timelineCoverageStaging,
      columns: coverageColumns,
      dedupe: "timeline-coverage",
      predicate: byMatch,
    }),
    columns: coverageColumns,
    select: (from) => `SELECT DISTINCT match_id FROM ${from}`,
  });
}

function groupByMatch<Row extends { match_id: string }>(
  rows: readonly Row[],
): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const matchRows = grouped.get(row.match_id) ?? [];
    matchRows.push(row);
    grouped.set(row.match_id, matchRows);
  }
  return grouped;
}

async function queryRows<T>(
  session: DuckDBSession,
  sql: string,
  params: string[],
  schema: z.ZodType<T>,
): Promise<T[]> {
  const rows = await session.run(sql, params);
  return rows.map((row) => schema.parse(row));
}

/** Derive one partition month's rows from the staged temp tables. */
async function deriveMonth(
  session: DuckDBSession,
  month: string,
  derivedAt: string,
): Promise<ReturnType<typeof laneResultRows>> {
  const participants: LaneParticipant[] = await queryRows(
    session,
    `SELECT * FROM ${TEMP_PARTICIPANTS} WHERE month = $1 ORDER BY match_id, participant_id`,
    [month],
    LaneParticipantSchema,
  );
  const inMonth = `match_id IN (SELECT match_id FROM ${TEMP_PARTICIPANTS} WHERE month = $1)`;
  const frames = groupByMatch(
    await queryRows(
      session,
      `SELECT * FROM ${TEMP_FRAMES} WHERE ${inMonth} ORDER BY match_id, participant_id`,
      [month],
      MatchFrameSchema,
    ),
  );
  const timelineRows = await queryRows(
    session,
    `SELECT match_id FROM ${TEMP_TIMELINES} WHERE ${inMonth}`,
    [month],
    MatchIdRowSchema,
  );
  const timelines = new Set(timelineRows.map((row) => row.match_id));
  return [...groupByMatch(participants)].flatMap(([matchId, rows]) =>
    laneResultRows({
      participants: rows,
      frames: (frames.get(matchId) ?? []).map(
        ({ match_id: _matchId, ...frame }): LaneDeltaFrame => frame,
      ),
      hasTimeline: timelines.has(matchId),
      derivedAt,
    }),
  );
}

/**
 * Write `lane_results` Parquet into a candidate build for the scope's matches.
 *
 * A rebuild derives every match (`scope: "all"`); a fold derives the matches
 * its staged match or timeline rows name, written as fold files beside the
 * previous build's rows. Both run the same derivation over the build's own
 * Parquet, so a fold and a rebuild of the same lake hold the same rows once
 * readers keep the newest derivation per laner.
 */
export async function writeLaneResultsParquet(options: {
  buildDir: string;
  inputs: LaneResultInputs;
  scope: LaneResultScope;
  derivedAt: Date;
  /** Fold files carry the build id so they never collide with linked files. */
  foldBuildId?: string;
  timeoutMs: number;
  abortSignal?: AbortSignal | undefined;
}): Promise<number> {
  options.abortSignal?.throwIfAborted();
  if (options.scope !== "all" && options.scope.length === 0) return 0;
  const tmpPath = path.join(
    options.buildDir,
    `${LANE_RESULTS_TABLE}.ndjson.tmp`,
  );
  const writer = new NdjsonFileWriter(tmpPath, undefined, options.abortSignal);
  const derivedAt = lakeTimestamp(options.derivedAt.getTime());
  try {
    return await withMaintenanceDuckDBConnection(
      // Each maintenance connection is fresh and closed afterwards, so the
      // temp tables die with it.
      async (session) => {
        await stageInputs(session, options.inputs, options.scope);
        const months = await queryRows(
          session,
          `SELECT DISTINCT month FROM ${TEMP_PARTICIPANTS} ORDER BY month`,
          [],
          MonthRowSchema,
        );
        for (const { month } of months) {
          options.abortSignal?.throwIfAborted();
          for (const row of await deriveMonth(session, month, derivedAt)) {
            await writer.write(row);
          }
        }
        await writer.close();
        if (writer.rows > 0) {
          await copyNdjsonToParquet(session, {
            sourcePath: tmpPath,
            outputDirectory: path.join(options.buildDir, LANE_RESULTS_TABLE),
            columns: LANE_RESULT_LAKE_COLUMNS,
            partitionByMonth: true,
            ...(options.foldBuildId === undefined
              ? {}
              : { fileNamePrefix: `fold-${options.foldBuildId}` }),
          });
        }
        return writer.rows;
      },
      {
        timeoutMs: options.timeoutMs,
        ...(options.abortSignal === undefined
          ? {}
          : { abortSignal: options.abortSignal }),
      },
    );
  } finally {
    await writer.abort();
    await rm(tmpPath, { force: true });
  }
}

/** The match ids a fold's staged rows name, which its derivation covers. */
export function stagedLaneResultScope(
  staged: readonly { rowsByMonth: Map<string, object[]> }[],
): string[] {
  const ids = new Set<string>();
  for (const table of staged) {
    for (const rows of table.rowsByMonth.values()) {
      for (const row of rows) ids.add(MatchIdRowSchema.parse(row).match_id);
    }
  }
  return [...ids].toSorted();
}
