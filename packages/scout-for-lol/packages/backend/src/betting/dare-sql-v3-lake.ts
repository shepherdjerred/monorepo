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
import { duckDbEmptySelect } from "#src/report-lake/schema.ts";
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
  },
): Promise<void> {
  const files = await resolveLakeFiles(input.lakeDir);
  const windowPredicate = {
    sql: "epoch_ms(game_end_at) BETWEEN ? AND ?",
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
  const allTargetAccounts = input.targets.flatMap((target) => target.accounts);
  const targetMembership = allTargetAccounts.map(
    () => "(puuid = ? AND epoch_ms(game_end_at) >= ?)",
  );
  const targetParams = allTargetAccounts.flatMap((account) => [
    scalarParam(account.puuid),
    scalarParam(new Date(account.trackingStartedAt).getTime()),
  ]);
  await session.run(
    `CREATE TEMP TABLE _dare_match_ids AS
     SELECT match_id
     FROM _dare_match_window
     WHERE ${targetMembership.join(" OR ")}
     GROUP BY match_id
     ORDER BY MIN(game_end_at), match_id
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
  await materialize(
    session,
    "match_teams",
    buildMatchTeamsSource(files, matchFilter),
    MATCH_TEAM_LAKE_COLUMNS,
  );
  if (input.excludeMultiTeamGames) {
    await session.run(
      `CREATE TEMP TABLE _dare_multi_team_ids AS
       SELECT match_id FROM match_teams GROUP BY match_id HAVING COUNT(DISTINCT team_id) <> 2`,
    );
    await session.run(
      "DELETE FROM match_participants WHERE match_id IN (SELECT match_id FROM _dare_multi_team_ids)",
    );
    await session.run(
      "DELETE FROM match_teams WHERE match_id IN (SELECT match_id FROM _dare_multi_team_ids)",
    );
    await session.run(
      "DELETE FROM _dare_match_ids WHERE match_id IN (SELECT match_id FROM _dare_multi_team_ids)",
    );
  }
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

export function dareSqlV3ComparesOpponentTeams(canonicalSql: string): boolean {
  return /\b(?:[a-z_]\w*\.)?team_id\s*(?:<>|!=)\s*(?:[a-z_]\w*\.)?team_id\b/iu.test(
    canonicalSql,
  );
}
