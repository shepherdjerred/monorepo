import {
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  type DareTargetBindingV2,
  type DuckDbColumnType,
} from "@scout-for-lol/data";
import { REMAKE_MAX_DURATION_SECONDS } from "#src/betting/constants.ts";
import { duckDbEmptySelect } from "#src/report-lake/schema.ts";
import { relationalScoutQlStatementFromImmutableAst } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";
import type { DuckDBSession } from "#src/reports/duckdb/instance.ts";
import {
  buildMatchesSource,
  buildMatchTeamBansSource,
  buildMatchTeamsSource,
  buildTimelineCoverageSource,
  buildTimelineEventParticipantsSource,
  buildTimelineEventsSource,
  buildTimelineParticipantFramesSource,
  resolveLakeFiles,
  scalarParam,
  type BoundParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

const TARGET_KEY = /^T[1-5]$/u;

function bindParams(session: DuckDBSession, params: BoundParam[]) {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

async function materialize(
  session: DuckDBSession,
  table: string,
  source: SqlFragment | undefined,
  columns: Record<string, DuckDbColumnType>,
): Promise<void> {
  const body = source?.sql ?? duckDbEmptySelect(columns);
  await session.run(
    `CREATE TEMP TABLE ${table} AS ${body}`,
    source === undefined ? [] : bindParams(session, source.params),
  );
}

function targetPredicate(target: DareTargetBindingV2): SqlFragment {
  const clauses: string[] = [];
  const params: BoundParam[] = [];
  for (const account of target.accounts) {
    clauses.push("(puuid = ? AND epoch_ms(game_end_at) >= ?)");
    params.push(
      scalarParam(account.puuid),
      scalarParam(new Date(account.trackingStartedAt).getTime()),
    );
  }
  return { sql: clauses.join(" OR "), params };
}

async function createTargetRelations(
  session: DuckDBSession,
  targets: readonly DareTargetBindingV2[],
): Promise<void> {
  for (const target of targets) {
    if (!TARGET_KEY.test(target.key)) {
      throw new Error(
        `Dare SQL target key ${target.key} must be T1 through T5.`,
      );
    }
    const predicate = targetPredicate(target);
    await session.run(
      `CREATE TEMP TABLE ${target.key} AS SELECT * FROM match_participants WHERE ${predicate.sql}`,
      bindParams(session, predicate.params),
    );
  }
}

export async function createDareSqlV3LakeRelations(
  session: DuckDBSession,
  input: {
    targets: readonly DareTargetBindingV2[];
    start: Date;
    end: Date;
    lakeDir: string;
    maxEligibleGames: number;
    excludeMultiTeamGames: boolean;
    matchOrder: "oldest" | "newest";
  },
): Promise<void> {
  const files = await resolveLakeFiles(input.lakeDir);
  const windowPredicate = {
    sql: "epoch_ms(game_start_at) > ? AND epoch_ms(game_end_at) <= ?",
    params: [
      scalarParam(input.start.getTime()),
      scalarParam(input.end.getTime()),
    ],
  };
  await materialize(
    session,
    "_dare_match_window",
    buildMatchesSource(files, windowPredicate),
    MATCH_LAKE_COLUMNS,
  );
  await session.run(
    `CREATE TEMP TABLE _dare_remake_ids AS
     SELECT match_id
     FROM _dare_match_window
     GROUP BY match_id
     HAVING BOOL_OR(
       COALESCE(end_of_game_result <> 'GameComplete', TRUE)
       OR COALESCE(game_duration_seconds < ?, TRUE)
       OR COALESCE(game_ended_in_early_surrender, FALSE)
       OR COALESCE(team_early_surrendered, FALSE)
     )`,
    [REMAKE_MAX_DURATION_SECONDS],
  );
  const allTargetAccounts = input.targets.flatMap((target) => target.accounts);
  const targetMembership = allTargetAccounts.map(
    () => "(puuid = ? AND epoch_ms(game_end_at) >= ?)",
  );
  const targetParams = allTargetAccounts.flatMap((account) => [
    scalarParam(account.puuid),
    scalarParam(new Date(account.trackingStartedAt).getTime()),
  ]);
  const windowMatchFilter = {
    sql: "match_id IN (SELECT DISTINCT match_id FROM _dare_match_window)",
    params: [],
  };
  await materialize(
    session,
    "_dare_match_teams_window",
    buildMatchTeamsSource(files, windowMatchFilter),
    MATCH_TEAM_LAKE_COLUMNS,
  );
  if (input.excludeMultiTeamGames) {
    await session.run(
      `CREATE TEMP TABLE _dare_multi_team_ids AS
       SELECT match_id FROM _dare_match_teams_window GROUP BY match_id HAVING COUNT(DISTINCT team_id) <> 2`,
    );
  }
  const multiTeamClause = input.excludeMultiTeamGames
    ? "AND match_id NOT IN (SELECT match_id FROM _dare_multi_team_ids)"
    : "";
  const matchOrder = input.matchOrder === "newest" ? "DESC" : "ASC";
  await session.run(
    `CREATE TEMP TABLE _dare_match_ids AS
     SELECT match_id
     FROM _dare_match_window
     WHERE (${targetMembership.join(" OR ")})
     AND match_id NOT IN (SELECT match_id FROM _dare_remake_ids)
     ${multiTeamClause}
     GROUP BY match_id
     ORDER BY MIN(game_end_at) ${matchOrder}, match_id ${matchOrder}
     LIMIT ?`,
    bindParams(session, [...targetParams, scalarParam(input.maxEligibleGames)]),
  );
  await session.run(
    "CREATE TEMP TABLE match_participants AS SELECT * FROM _dare_match_window WHERE match_id IN (SELECT match_id FROM _dare_match_ids)",
  );
  await session.run(
    "CREATE TEMP VIEW matches AS SELECT DISTINCT match_id, game_id, platform_id, month, game_creation_at, game_start_at, game_end_at, game_duration_seconds, queue_id, queue, game_mode, game_type, game_version, end_of_game_result, map_id FROM match_participants",
  );
  const matchFilter = {
    sql: "match_id IN (SELECT match_id FROM _dare_match_ids)",
    params: [],
  };
  await session.run(
    "CREATE TEMP TABLE match_teams AS SELECT * FROM _dare_match_teams_window WHERE match_id IN (SELECT match_id FROM _dare_match_ids)",
  );
  await materialize(
    session,
    "match_team_bans",
    buildMatchTeamBansSource(files, matchFilter),
    MATCH_TEAM_BAN_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_events",
    buildTimelineEventsSource(files, matchFilter),
    TIMELINE_EVENT_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_event_participants",
    buildTimelineEventParticipantsSource(files, matchFilter),
    TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_participant_frames",
    buildTimelineParticipantFramesSource(files, matchFilter),
    TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  );
  await materialize(
    session,
    "timeline_coverage",
    buildTimelineCoverageSource(files, matchFilter),
    TIMELINE_COVERAGE_LAKE_COLUMNS,
  );
  await createTargetRelations(session, input.targets);
}

function isTeamIdReference(value: JsonValue | undefined): boolean {
  const expression = objectValue(value);
  if (
    expression === null ||
    stringValue(expression["class"]) !== "COLUMN_REF"
  ) {
    return false;
  }
  return (
    stringValue(arrayValue(expression["column_names"]).at(-1)) === "team_id"
  );
}

function containsOpponentTeamComparison(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsOpponentTeamComparison(child));
  }
  const expression = objectValue(value);
  if (expression === null) return false;
  if (
    stringValue(expression["class"]) === "COMPARISON" &&
    stringValue(expression["type"]) === "COMPARE_NOTEQUAL" &&
    isTeamIdReference(expression["left"]) &&
    isTeamIdReference(expression["right"])
  ) {
    return true;
  }
  return Object.values(expression).some((child) =>
    containsOpponentTeamComparison(child),
  );
}

export function dareSqlV3ComparesOpponentTeams(immutableAst: string): boolean {
  return containsOpponentTeamComparison(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
  );
}
