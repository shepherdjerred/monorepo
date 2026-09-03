import path from "node:path";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import {
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
} from "@scout-for-lol/data";
import {
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
} from "@scout-for-lol/data/model/timeline-lake-columns.ts";
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import { listStagingFiles } from "#src/report-lake/staging.ts";

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
  matchesParquet: string[];
  matchesStaging: string[];
  matchTeamsParquet: string[];
  matchTeamsStaging: string[];
  matchTeamBansParquet: string[];
  matchTeamBansStaging: string[];
  prematchParquet: string[];
  prematchStaging: string[];
  accountsParquet: string | undefined;
  competitionRankHistoryParquet: string[];
  competitionRankHistoryStaging: string[];
  timelineEventsParquet: string[];
  timelineEventsStaging: string[];
  timelineEventParticipantsParquet: string[];
  timelineEventParticipantsStaging: string[];
  timelineParticipantFramesParquet: string[];
  timelineParticipantFramesStaging: string[];
  timelineCoverageParquet: string[];
  timelineCoverageStaging: string[];
};

async function globParquet(root: string, table: string): Promise<string[]> {
  const glob = new Bun.Glob(`${table}/**/*.parquet`);
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: root, absolute: true })) {
    files.push(file);
  }
  return files.toSorted();
}

export async function resolveLakeFiles(lakeDir: string): Promise<LakeFiles> {
  const buildDir = await readCurrentBuildDir(lakeDir);
  const [
    matchesStaging,
    matchTeamsStaging,
    matchTeamBansStaging,
    prematchStaging,
    competitionRankHistoryStaging,
    timelineEventsStaging,
    timelineEventParticipantsStaging,
    timelineParticipantFramesStaging,
    timelineCoverageStaging,
  ] = await Promise.all([
    listStagingFiles(lakeDir, "matches"),
    listStagingFiles(lakeDir, "match_teams"),
    listStagingFiles(lakeDir, "match_team_bans"),
    listStagingFiles(lakeDir, "prematch"),
    listStagingFiles(lakeDir, "competition_rank_history"),
    listStagingFiles(lakeDir, "timeline_events"),
    listStagingFiles(lakeDir, "timeline_event_participants"),
    listStagingFiles(lakeDir, "timeline_participant_frames"),
    listStagingFiles(lakeDir, "timeline_coverage"),
  ]);
  if (buildDir === undefined) {
    return {
      matchesParquet: [],
      matchesStaging,
      matchTeamsParquet: [],
      matchTeamsStaging,
      matchTeamBansParquet: [],
      matchTeamBansStaging,
      prematchParquet: [],
      prematchStaging,
      accountsParquet: undefined,
      competitionRankHistoryParquet: [],
      competitionRankHistoryStaging,
      timelineEventsParquet: [],
      timelineEventsStaging,
      timelineEventParticipantsParquet: [],
      timelineEventParticipantsStaging,
      timelineParticipantFramesParquet: [],
      timelineParticipantFramesStaging,
      timelineCoverageParquet: [],
      timelineCoverageStaging,
    };
  }
  const [
    matchesParquet,
    matchTeamsParquet,
    matchTeamBansParquet,
    prematchParquet,
    competitionRankHistoryParquet,
    timelineEventsParquet,
    timelineEventParticipantsParquet,
    timelineParticipantFramesParquet,
    timelineCoverageParquet,
  ] = await Promise.all([
    globParquet(buildDir, "matches"),
    globParquet(buildDir, "match_teams"),
    globParquet(buildDir, "match_team_bans"),
    globParquet(buildDir, "prematch"),
    globParquet(buildDir, "competition_rank_history"),
    globParquet(buildDir, "timeline_events"),
    globParquet(buildDir, "timeline_event_participants"),
    globParquet(buildDir, "timeline_participant_frames"),
    globParquet(buildDir, "timeline_coverage"),
  ]);
  const accountsPath = path.join(buildDir, "accounts", "accounts.parquet");
  const accountsParquet = (await Bun.file(accountsPath).exists())
    ? accountsPath
    : undefined;
  return {
    matchesParquet,
    matchesStaging,
    matchTeamsParquet,
    matchTeamsStaging,
    matchTeamBansParquet,
    matchTeamBansStaging,
    prematchParquet,
    prematchStaging,
    accountsParquet,
    competitionRankHistoryParquet,
    competitionRankHistoryStaging,
    timelineEventsParquet,
    timelineEventsStaging,
    timelineEventParticipantsParquet,
    timelineEventParticipantsStaging,
    timelineParticipantFramesParquet,
    timelineParticipantFramesStaging,
    timelineCoverageParquet,
    timelineCoverageStaging,
  };
}

/** Column list rendered from our own constants — safe to embed in SQL text. */
function columnList(columns: Record<string, string>): string {
  return Object.keys(columns).join(", ");
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
    | "timeline-coverage";
  /** WHERE predicate pushed into BOTH branches (empty sql = no filter). */
  predicate: SqlFragment;
};

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
      case "matches":
        return "match_id, puuid";
      case "match-teams":
        return "match_id, team_id";
      case "match-team-bans":
        return "match_id, team_id, pick_turn";
      case "prematch":
        return "dedupe_key, puuid";
      case "timeline-events":
        return "event_id";
      case "timeline-event-participants":
        return "event_id, participant_id, role, role_index";
      case "timeline-participant-frames":
        return "match_id, frame_index, participant_id";
      case "timeline-coverage":
        return "match_id";
    }
  })();
  const sourceOrder = "src";
  return {
    sql: `SELECT * FROM (${unioned}) QUALIFY row_number() OVER (PARTITION BY ${partition} ORDER BY ${sourceOrder}) = 1`,
    params,
  };
}

export function buildMatchesSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.matchesParquet,
    stagingFiles: files.matchesStaging,
    columns: MATCH_LAKE_COLUMNS,
    dedupe: "matches",
    predicate,
  });
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

export function buildMatchTeamsSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.matchTeamsParquet,
    stagingFiles: files.matchTeamsStaging,
    columns: MATCH_TEAM_LAKE_COLUMNS,
    dedupe: "match-teams",
    predicate,
  });
}

export function buildMatchTeamBansSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.matchTeamBansParquet,
    stagingFiles: files.matchTeamBansStaging,
    columns: MATCH_TEAM_BAN_LAKE_COLUMNS,
    dedupe: "match-team-bans",
    predicate,
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

export function buildTimelineEventsSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.timelineEventsParquet,
    stagingFiles: files.timelineEventsStaging,
    columns: TIMELINE_EVENT_LAKE_COLUMNS,
    dedupe: "timeline-events",
    predicate,
  });
}

export function buildTimelineEventParticipantsSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.timelineEventParticipantsParquet,
    stagingFiles: files.timelineEventParticipantsStaging,
    columns: TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
    dedupe: "timeline-event-participants",
    predicate,
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

/** accounts dimension scoped to one Discord server. */
export function buildAccountsSource(
  accountsParquet: string,
  serverId: string,
): SqlFragment {
  return {
    sql: `SELECT puuid, player_id, player_alias, discord_id FROM read_parquet(?) WHERE server_id = ?`,
    params: [listParam([accountsParquet]), scalarParam(serverId)],
  };
}
