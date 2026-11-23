import configuration from "#src/configuration.ts";
import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";
import {
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "@scout-for-lol/data";
import { matchReadColumns } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import {
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
} from "@scout-for-lol/data/model/reports/timeline-lake-columns.ts";
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import { retryLakeQuery } from "#src/reports/duckdb/lake/query-retry.ts";
import type { LakeFiles as CapturedLakeFiles } from "#src/reports/duckdb/lake/files.ts";
import { resolveLakeFiles as resolveCapturedLakeFiles } from "#src/reports/duckdb/lake/resolve-files.ts";
import { columnList } from "#src/reports/duckdb/lake/column-list.ts";
import {
  withPopulation,
  type SourceOptions,
} from "#src/reports/duckdb/lake/crawl-union.ts";
import {
  CRAWL_MATCH_LAKE_COLUMNS,
  CRAWL_MATCH_TEAM_BAN_LAKE_COLUMNS,
  CRAWL_MATCH_TEAM_LAKE_COLUMNS,
  CRAWL_TIMELINE_EVENT_LAKE_COLUMNS,
  CRAWL_TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";

/**
 * Lake file resolution and relation-SQL builders for the DuckDB report
 * engine.
 *
 * A "relation" here is a SQL fragment reading the published parquet build
 * UNION ALL BY NAME the NDJSON staging files, deduped on the row's natural
 * key. Daily leaderboard snapshots prefer the newest observation. Two
 * invariants from the design/POC:
 *
 * - Filters MUST be pushed into each union branch BEFORE the dedupe window
 *   function (12x faster at scale; semantics-preserving because duplicated
 *   rows are identical in both branches).
 * - File paths and every runtime value are bound parameters; the only SQL
 *   text that varies is assembled from closed enums and our own column
 *   constants.
 */

/** Structurally the same as `LakeBoundParam`, which lake/ modules name. */
export type BoundParam =
  | { kind: "scalar"; value: string | number | boolean }
  | { kind: "list"; values: string[] | number[] };

export function scalarParam(value: string | number | boolean): BoundParam {
  return { kind: "scalar", value };
}

export function listParam(values: string[] | number[]): BoundParam {
  return { kind: "list", values };
}

export type SqlFragment = {
  sql: string;
  params: BoundParam[];
};

export type LakeFiles = {
  [Key in keyof CapturedLakeFiles]: CapturedLakeFiles[Key];
};

/** The files one query attempt reads (see lake/resolve-files.ts). */
export async function resolveLakeFiles(
  lakeDir: string,
  capabilities: Pick<
    ScoutRuntimeCapabilities,
    "reportLakeAccess"
  > = configuration.runtimeCapabilities,
): Promise<LakeFiles> {
  return await resolveCapturedLakeFiles(lakeDir, capabilities);
}

export async function withLakeQueryRetry<T>(
  lakeDir: string,
  query: (files: LakeFiles) => Promise<T>,
  capabilities: Pick<
    ScoutRuntimeCapabilities,
    "reportLakeAccess"
  > = configuration.runtimeCapabilities,
): Promise<T> {
  return await retryLakeQuery(lakeDir, query, capabilities, resolveLakeFiles);
}

type UnionSourceInput = {
  parquetFiles: string[];
  stagingFiles: string[];
  columns: Record<
    string,
    "VARCHAR" | "INTEGER" | "BIGINT" | "DOUBLE" | "BOOLEAN" | "TIMESTAMP"
  >;
  dedupe:
    | "matches"
    | "match-teams"
    | "match-team-bans"
    | "prematch"
    | "competition-rank-daily-snapshot"
    | "timeline-events"
    | "timeline-event-participants"
    | "timeline-participant-frames"
    | "timeline-coverage"
    | "raw-documents";
  /** WHERE predicate pushed into BOTH branches (empty sql = no filter). */
  predicate: SqlFragment;
};

/**
 * Tables whose compacted parquet is already unique per key, because the
 * rebuild emits one timeline per match (report-lake/rebuild-sources.ts).
 * Only a staged row can duplicate one, and the compacted row wins.
 */
const COMPACTED_UNIQUE = new Set<UnionSourceInput["dedupe"]>([
  "timeline-events",
  "timeline-event-participants",
  "timeline-participant-frames",
  "timeline-coverage",
]);

/**
 * The same rows the row_number dedupe keeps, without windowing the whole
 * table: compacted rows as they are, plus staged rows no compacted row
 * already holds, deduped among themselves. A window over every frame in a
 * production lake ran out of the report memory limit; staging is small.
 */
function compactedFirstSource(
  input: UnionSourceInput,
  partition: string,
): SqlFragment {
  const cols = columnList(input.columns);
  const where =
    input.predicate.sql.length > 0 ? ` WHERE ${input.predicate.sql}` : "";
  const compacted = `SELECT ${cols}, 1 AS src FROM read_parquet(?)${where}`;
  const compactedParams = [
    listParam(input.parquetFiles),
    ...input.predicate.params,
  ];
  if (input.stagingFiles.length === 0) {
    return { sql: compacted, params: compactedParams };
  }
  const staged = `SELECT * FROM (SELECT ${cols}, 2 AS src FROM read_json(?, format='newline_delimited', columns=${duckDbColumnsSpec(input.columns)})${where}) QUALIFY row_number() OVER (PARTITION BY ${partition}) = 1`;
  const stagedParams = [
    listParam(input.stagingFiles),
    ...input.predicate.params,
  ];
  if (input.parquetFiles.length === 0) {
    return { sql: staged, params: stagedParams };
  }
  const sameKey = partition
    .split(", ")
    .map((key) => `c.${key} = s.${key}`)
    .join(" AND ");
  return {
    sql: `${compacted} UNION ALL BY NAME SELECT s.* FROM (${staged}) s ANTI JOIN (${compacted}) c ON ${sameKey}`,
    params: [...compactedParams, ...stagedParams, ...compactedParams],
  };
}

/** A participant row's natural key. See the `matches` dedupe below. */
const MATCH_DEDUPE_KEY =
  "match_id, puuid, participant_id, team_id, champion_id";

/**
 * Build the deduped parquet ∪ staging source for one lake table. Returns
 * undefined when there are no files at all (caller short-circuits).
 */
export function buildUnionSource(
  input: UnionSourceInput,
): SqlFragment | undefined {
  const cols = columnList(input.columns);
  const where =
    input.predicate.sql.length > 0 ? ` WHERE ${input.predicate.sql}` : "";
  const branches: string[] = [];
  const params: BoundParam[] = [];

  if (input.parquetFiles.length > 0) {
    branches.push(`SELECT ${cols}, 1 AS src FROM read_parquet(?)${where}`);
    params.push(listParam(input.parquetFiles), ...input.predicate.params);
  }
  if (input.stagingFiles.length > 0) {
    branches.push(
      `SELECT ${cols}, 2 AS src FROM read_json(?, format='newline_delimited', columns=${duckDbColumnsSpec(input.columns)})${where}`,
    );
    params.push(listParam(input.stagingFiles), ...input.predicate.params);
  }
  if (branches.length === 0) {
    return undefined;
  }

  const unioned = branches.join(" UNION ALL BY NAME ");
  if (input.dedupe === "competition-rank-daily-snapshot") {
    return {
      sql: `WITH candidates AS (${unioned}), latest_snapshots AS (SELECT competition_id, CAST(calculated_at AS DATE) AS snapshot_date, MAX(calculated_at) AS latest_snapshot_at FROM candidates GROUP BY competition_id, snapshot_date), latest_candidates AS (SELECT candidates.*, latest_snapshots.snapshot_date FROM candidates INNER JOIN latest_snapshots ON candidates.competition_id = latest_snapshots.competition_id AND candidates.calculated_at = latest_snapshots.latest_snapshot_at) SELECT * EXCLUDE (snapshot_date) FROM latest_candidates QUALIFY row_number() OVER (PARTITION BY competition_id, CAST(calculated_at AS DATE), player_id ORDER BY src DESC) = 1`,
      params,
    };
  }
  const partition = (() => {
    switch (input.dedupe) {
      // A bot or an unresolved player has a NULL puuid, and PARTITION BY
      // groups NULLs together, so the key also names the slot, team and
      // champion. For a player the PUUID alone already decides the row.
      case "matches":
        return MATCH_DEDUPE_KEY;
      case "match-teams":
        return "match_id, team_id";
      case "match-team-bans":
        return "match_id, team_id, pick_turn";
      // A bot's prematch row has a NULL puuid, so team and champion tell bots
      // apart.
      case "prematch":
        return "dedupe_key, puuid, team_id, champion_id";
      case "timeline-events":
        return "event_id";
      case "timeline-event-participants":
        return "event_id, participant_id, role, role_index";
      case "timeline-participant-frames":
        return "match_id, frame_index, participant_id";
      case "timeline-coverage":
        return "match_id";
      case "raw-documents":
        return "document_id";
    }
  })();
  if (COMPACTED_UNIQUE.has(input.dedupe)) {
    return compactedFirstSource(input, partition);
  }
  const sourceOrder =
    input.dedupe === "raw-documents"
      ? "captured_at DESC, src DESC, source_digest"
      : "src";
  return {
    sql: `SELECT * FROM (${unioned}) QUALIFY row_number() OVER (PARTITION BY ${partition} ORDER BY ${sourceOrder}) = 1`,
    params,
  };
}

/**
 * Participant rows over `columns` for the requested population: the tracked
 * `matches` union, plus `matches_crawl` for `all` (see crawl-union.ts).
 */
function participantSource(
  files: LakeFiles,
  predicate: SqlFragment,
  columns: Record<string, DuckDbColumnType>,
  options: SourceOptions,
): SqlFragment | undefined {
  return withPopulation({
    files,
    tracked: buildUnionSource({
      parquetFiles: files.matchesParquet,
      stagingFiles: files.matchesStaging,
      columns,
      dedupe: "matches",
      predicate,
    }),
    crawl: { files: files.crawl.matches, columns: CRAWL_MATCH_LAKE_COLUMNS },
    columns,
    predicate,
    options,
  });
}

/**
 * Seconds a participant played, for per-minute rates: `time_played`, or the
 * game's length for a history record, which does not state it.
 */
export const PLAYED_SECONDS_SQL =
  "COALESCE(time_played, game_duration_seconds)";

/**
 * When a game began, for ordering, paging and date windows: the lobby's
 * creation, or for an end-of-game record, which states no creation, its
 * start. The lake's form of `canonicalMatchCreatedAt`, which partitions the
 * same record by the same instant. The source must project `game_start_at`.
 */
export const GAME_CREATED_AT_SQL = "COALESCE(game_creation_at, game_start_at)";

/** {@link GAME_CREATED_AT_SQL} in epoch milliseconds. */
export const GAME_CREATED_MS_SQL = `epoch_ms(${GAME_CREATED_AT_SQL})`;

/** Participant rows, with the loadout columns the caller reads. */
export function buildMatchesSource(
  files: LakeFiles,
  predicate: SqlFragment,
  loadout: readonly string[] = [],
  options: SourceOptions = {},
): SqlFragment | undefined {
  return participantSource(
    files,
    predicate,
    matchReadColumns(loadout),
    options,
  );
}

export function buildPrematchSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.prematchParquet,
    stagingFiles: files.prematchStaging,
    columns: PREMATCH_LAKE_COLUMNS,
    dedupe: "prematch",
    predicate,
  });
}

/**
 * The match-level columns a team row needs, and nothing else.
 *
 * A team row carries no timestamp, queue or version, so `match_teams` queries
 * look them up from the participant table. Reading them through
 * `buildMatchesSource` would project all ninety-odd participant columns and
 * defeat parquet's column pruning on every objective query; this narrow map
 * reads the few it needs plus the dedupe key's columns.
 */
const MATCH_DIMENSION_LAKE_COLUMNS = {
  match_id: MATCH_LAKE_COLUMNS.match_id,
  puuid: MATCH_LAKE_COLUMNS.puuid,
  participant_id: MATCH_LAKE_COLUMNS.participant_id,
  team_id: MATCH_LAKE_COLUMNS.team_id,
  champion_id: MATCH_LAKE_COLUMNS.champion_id,
  game_creation_at: MATCH_LAKE_COLUMNS.game_creation_at,
  queue: MATCH_LAKE_COLUMNS.queue,
  game_version: MATCH_LAKE_COLUMNS.game_version,
  map_id: MATCH_LAKE_COLUMNS.map_id,
} as const;

export function buildMatchDimensionSource(
  files: LakeFiles,
  predicate: SqlFragment,
  options: SourceOptions = {},
): SqlFragment | undefined {
  return participantSource(
    files,
    predicate,
    MATCH_DIMENSION_LAKE_COLUMNS,
    options,
  );
}

/**
 * The participant facts a timeline row lacks, and nothing more.
 *
 * A frame or event names a participant by puuid or slot but carries no
 * champion, position, team, result or match time. Those are read from the
 * participant row — one per (match, slot), which the `matches` dedupe
 * already guarantees — through this narrow projection rather than all
 * ninety-odd participant columns.
 */
const PARTICIPANT_DIMENSION_LAKE_COLUMNS = {
  ...MATCH_DIMENSION_LAKE_COLUMNS,
  champion_name: MATCH_LAKE_COLUMNS.champion_name,
  team_position: MATCH_LAKE_COLUMNS.team_position,
  win: MATCH_LAKE_COLUMNS.win,
  riot_id_game_name: MATCH_LAKE_COLUMNS.riot_id_game_name,
  riot_id_tagline: MATCH_LAKE_COLUMNS.riot_id_tagline,
} as const;

export function buildParticipantDimensionSource(
  files: LakeFiles,
  predicate: SqlFragment,
  options: SourceOptions = {},
): SqlFragment | undefined {
  return participantSource(
    files,
    predicate,
    PARTICIPANT_DIMENSION_LAKE_COLUMNS,
    options,
  );
}

/**
 * Who a PUUID has been, and when: the identity dimension `reports/identity.ts`
 * resolves names against. It reads the Riot ID, the match time and the dedupe
 * key, never the ninety-odd participant columns, so a name lookup over the
 * `all` population reads a few narrow crawl columns rather than whole rows.
 */
const IDENTITY_DIMENSION_LAKE_COLUMNS = {
  match_id: MATCH_LAKE_COLUMNS.match_id,
  puuid: MATCH_LAKE_COLUMNS.puuid,
  participant_id: MATCH_LAKE_COLUMNS.participant_id,
  team_id: MATCH_LAKE_COLUMNS.team_id,
  champion_id: MATCH_LAKE_COLUMNS.champion_id,
  game_creation_at: MATCH_LAKE_COLUMNS.game_creation_at,
  // An end-of-game record's creation is its start (GAME_CREATED_AT_SQL).
  game_start_at: MATCH_LAKE_COLUMNS.game_start_at,
  riot_id_game_name: MATCH_LAKE_COLUMNS.riot_id_game_name,
  riot_id_tagline: MATCH_LAKE_COLUMNS.riot_id_tagline,
} as const;

export function buildIdentityDimensionSource(
  files: LakeFiles,
  predicate: SqlFragment,
  options: SourceOptions = {},
): SqlFragment | undefined {
  return participantSource(
    files,
    predicate,
    IDENTITY_DIMENSION_LAKE_COLUMNS,
    options,
  );
}

export function buildMatchTeamsSource(
  files: LakeFiles,
  predicate: SqlFragment,
  options: SourceOptions = {},
): SqlFragment | undefined {
  return withPopulation({
    files,
    tracked: buildUnionSource({
      parquetFiles: files.matchTeamsParquet,
      stagingFiles: files.matchTeamsStaging,
      columns: MATCH_TEAM_LAKE_COLUMNS,
      dedupe: "match-teams",
      predicate,
    }),
    crawl: {
      files: files.crawl.matchTeams,
      columns: CRAWL_MATCH_TEAM_LAKE_COLUMNS,
    },
    columns: MATCH_TEAM_LAKE_COLUMNS,
    predicate,
    options,
  });
}

export function buildMatchTeamBansSource(
  files: LakeFiles,
  predicate: SqlFragment,
  options: SourceOptions = {},
): SqlFragment | undefined {
  return withPopulation({
    files,
    tracked: buildUnionSource({
      parquetFiles: files.matchTeamBansParquet,
      stagingFiles: files.matchTeamBansStaging,
      columns: MATCH_TEAM_BAN_LAKE_COLUMNS,
      dedupe: "match-team-bans",
      predicate,
    }),
    crawl: {
      files: files.crawl.matchTeamBans,
      columns: CRAWL_MATCH_TEAM_BAN_LAKE_COLUMNS,
    },
    columns: MATCH_TEAM_BAN_LAKE_COLUMNS,
    predicate,
    options,
  });
}

export function buildCompetitionRankHistorySource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.competitionRankHistoryParquet,
    stagingFiles: files.competitionRankHistoryStaging,
    columns: COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
    dedupe: "competition-rank-daily-snapshot",
    predicate,
  });
}

/**
 * Timeline events. The crawl keeps only item and skill events, so a caller
 * asks for the `all` population only for a read restricted to those types
 * (`restrictsToCrawlEventTypes`); a crawl branch under any other read would
 * undercount every other event type.
 */
export function buildTimelineEventsSource(
  files: LakeFiles,
  predicate: SqlFragment,
  options: SourceOptions = {},
): SqlFragment | undefined {
  return withPopulation({
    files,
    tracked: buildUnionSource({
      parquetFiles: files.timelineEventsParquet,
      stagingFiles: files.timelineEventsStaging,
      columns: TIMELINE_EVENT_LAKE_COLUMNS,
      dedupe: "timeline-events",
      predicate,
    }),
    crawl: {
      files: files.crawl.timelineEvents,
      columns: CRAWL_TIMELINE_EVENT_LAKE_COLUMNS,
    },
    columns: TIMELINE_EVENT_LAKE_COLUMNS,
    predicate,
    options,
  });
}

export function buildTimelineEventParticipantsSource(
  files: LakeFiles,
  predicate: SqlFragment,
  options: SourceOptions = {},
): SqlFragment | undefined {
  return withPopulation({
    files,
    tracked: buildUnionSource({
      parquetFiles: files.timelineEventParticipantsParquet,
      stagingFiles: files.timelineEventParticipantsStaging,
      columns: TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
      dedupe: "timeline-event-participants",
      predicate,
    }),
    crawl: {
      files: files.crawl.timelineEventParticipants,
      columns: CRAWL_TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
    },
    columns: TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
    predicate,
    options,
  });
}

export function buildTimelineParticipantFramesSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.timelineParticipantFramesParquet,
    stagingFiles: files.timelineParticipantFramesStaging,
    columns: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
    dedupe: "timeline-participant-frames",
    predicate,
  });
}

/**
 * The frame scan the gold differences read: only the columns a team or lane
 * total needs. The dedupe window materializes every column it is handed, and
 * the full frame row made that window run out of memory at production size.
 */
export function buildFrameGoldSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  const all = TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS;
  return buildUnionSource({
    parquetFiles: files.timelineParticipantFramesParquet,
    stagingFiles: files.timelineParticipantFramesStaging,
    columns: {
      match_id: all.match_id,
      frame_index: all.frame_index,
      participant_id: all.participant_id,
      puuid: all.puuid,
      total_gold: all.total_gold,
    },
    dedupe: "timeline-participant-frames",
    predicate,
  });
}

export function buildTimelineCoverageSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.timelineCoverageParquet,
    stagingFiles: files.timelineCoverageStaging,
    columns: TIMELINE_COVERAGE_LAKE_COLUMNS,
    dedupe: "timeline-coverage",
    predicate,
  });
}
