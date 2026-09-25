import path from "node:path";
import configuration from "#src/configuration.ts";
import { RuntimeCapabilityError } from "#src/configuration/runtime-capability-error.ts";
import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import {
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
} from "@scout-for-lol/data";
import { MATCH_READ_COLUMNS } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import {
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
} from "@scout-for-lol/data/model/reports/timeline-lake-columns.ts";
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

/**
 * Refuse to resolve lake files on a role that does not declare lake access.
 *
 * This is a *structural* rule, and it is here rather than in `runtime/`
 * because of how the boot gate failed. `subsystems.ts` verifies a published
 * build only for roles whose `reportLakeAccess` is true — so the check a role
 * skips by declaring `false` is the very check that would have caught the
 * role reading the lake anyway. A capability whose `false` skips a safety
 * check cannot protect the role that sets it false; only an assertion at the
 * read site can.
 *
 * And the read site is where the damage is silent. An unmounted or
 * unpublished lake is not an error for DuckDB — it scans zero parquet files
 * and returns zero rows — so the caller does not fail, it reports "no games
 * found" and records a successful run. Every in-process lake reader funnels
 * through {@link resolveLakeFiles}, which is what makes one assertion here
 * cover Explore turns, report runs, dare settlement, parlay generation and
 * the consumer profile alike.
 *
 * No role in the table sets this false today, and that is the intended end
 * state rather than the reason to drop the guard: the table is the claim, and
 * this is what makes a future role's claim true or make it fail loudly.
 */
export function assertReportLakeAccess(
  capabilities: Pick<ScoutRuntimeCapabilities, "reportLakeAccess">,
): void {
  if (capabilities.reportLakeAccess) return;
  throw new RuntimeCapabilityError(
    "reportLakeAccess",
    "This process's runtime role does not declare reportLakeAccess, so it must not query the report lake. An unmounted or unpublished lake answers every query with zero rows instead of failing, which a caller records as a successful run that found nothing.",
  );
}

export async function resolveLakeFiles(
  lakeDir: string,
  capabilities: Pick<
    ScoutRuntimeCapabilities,
    "reportLakeAccess"
  > = configuration.runtimeCapabilities,
): Promise<LakeFiles> {
  assertReportLakeAccess(capabilities);
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
  if (COMPACTED_UNIQUE.has(input.dedupe)) {
    return compactedFirstSource(input, partition);
  }
  const sourceOrder = "src";
  return {
    sql: `SELECT * FROM (${unioned}) QUALIFY row_number() OVER (PARTITION BY ${partition} ORDER BY ${sourceOrder}) = 1`,
    params,
  };
}

export function buildMatchesSource(
  files: LakeFiles,
  predicate: SqlFragment,
  columns: "reads" | "with-items" = "reads",
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.matchesParquet,
    stagingFiles: files.matchesStaging,
    columns: columns === "reads" ? MATCH_READ_COLUMNS : MATCH_LAKE_COLUMNS,
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

/**
 * The match-level columns a team row needs, and nothing else.
 *
 * A team row carries no timestamp, queue or version, so `match_teams` queries
 * look them up from the participant table. Reading them through
 * `buildMatchesSource` would project all ninety-odd participant columns and
 * defeat parquet's column pruning on every objective query; this narrow map
 * reads six. `puuid` earns its place by being half the dedupe key.
 */
const MATCH_DIMENSION_LAKE_COLUMNS = {
  match_id: MATCH_LAKE_COLUMNS.match_id,
  puuid: MATCH_LAKE_COLUMNS.puuid,
  game_creation_at: MATCH_LAKE_COLUMNS.game_creation_at,
  queue: MATCH_LAKE_COLUMNS.queue,
  game_version: MATCH_LAKE_COLUMNS.game_version,
  map_id: MATCH_LAKE_COLUMNS.map_id,
} as const;

export function buildMatchDimensionSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.matchesParquet,
    stagingFiles: files.matchesStaging,
    columns: MATCH_DIMENSION_LAKE_COLUMNS,
    dedupe: "matches",
    predicate,
  });
}

/**
 * The participant facts a timeline row lacks, and nothing more.
 *
 * A frame or event names a participant by puuid or slot but carries no
 * champion, position, team, result or match time. Those are read from the
 * participant row — one per (match, puuid), which the `matches` dedupe
 * already guarantees — through this narrow projection rather than all
 * ninety-odd participant columns.
 */
const PARTICIPANT_DIMENSION_LAKE_COLUMNS = {
  ...MATCH_DIMENSION_LAKE_COLUMNS,
  participant_id: MATCH_LAKE_COLUMNS.participant_id,
  team_id: MATCH_LAKE_COLUMNS.team_id,
  champion_id: MATCH_LAKE_COLUMNS.champion_id,
  champion_name: MATCH_LAKE_COLUMNS.champion_name,
  team_position: MATCH_LAKE_COLUMNS.team_position,
  win: MATCH_LAKE_COLUMNS.win,
  riot_id_game_name: MATCH_LAKE_COLUMNS.riot_id_game_name,
  riot_id_tagline: MATCH_LAKE_COLUMNS.riot_id_tagline,
} as const;

export function buildParticipantDimensionSource(
  files: LakeFiles,
  predicate: SqlFragment,
): SqlFragment | undefined {
  return buildUnionSource({
    parquetFiles: files.matchesParquet,
    stagingFiles: files.matchesStaging,
    columns: PARTICIPANT_DIMENSION_LAKE_COLUMNS,
    dedupe: "matches",
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
