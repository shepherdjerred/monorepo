import type { ReportGroupBy, ReportQueryPlan } from "@scout-for-lol/data";
import { match } from "ts-pattern";
import {
  buildAccountsSource,
  buildMatchesSource,
  buildPrematchSource,
  listParam,
  scalarParam,
  type BoundParam,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import {
  groupFactSelect,
  matchAggregateSelect,
  prematchAggregateSelect,
} from "#src/reports/duckdb/metrics-sql.ts";

/**
 * ScoutQL plan → parameterized DuckDB SQL.
 *
 * Safety model: user-authored ScoutQL is parsed and compiled into a
 * Zod-validated ReportQueryPlan upstream (closed enums), so nothing here
 * ever interpolates a user string into SQL text — every runtime value
 * (dates, server id, queues, champion, player ids, file paths) is a bound
 * parameter, and the only varying SQL text is selected from closed enums
 * (group-by shape) or built from our own column constants.
 *
 * Ordering, minGames, limits, and derived metrics (win_rate, kda, …) run in
 * JS on the returned aggregate rows — see query-aggregates.ts — so ORDER
 * BY/LIMIT never reach SQL and legacy tie-break semantics are preserved
 * exactly.
 *
 * Legacy-compat quirk (pinned by parity tests): rowsScanned counts rows
 * AFTER the champion filter for match sources but BEFORE it for
 * prematch_participants, matching the fact engine's asymmetry.
 */

export type CompiledLakeQuery = {
  aggregateSql: string;
  aggregateParams: BoundParam[];
  scannedSql: string;
  scannedParams: BoundParam[];
};

export type LakeQueryInput = {
  plan: ReportQueryPlan;
  serverId: string;
  startMs: number;
  endMs: number;
  /** Competition scoping: restrict to these player ids (query-time). */
  playerIds?: number[];
  files: LakeFiles;
};

type Grouping = {
  labelExpr: string;
  discordExpr: string;
  groupExpr: string;
};

function matchGrouping(groupBy: ReportGroupBy): Grouping {
  return match(groupBy)
    .with("player", () => ({
      labelExpr: "any_value(player_alias)",
      discordExpr: "any_value(discord_id)",
      groupExpr: "player_id",
    }))
    .with("champion", () => ({
      labelExpr: "any_value(champion_name)",
      discordExpr: "NULL::VARCHAR",
      groupExpr: "champion_id",
    }))
    .with("queue", () => ({
      labelExpr: "COALESCE(queue, 'unknown')",
      discordExpr: "NULL::VARCHAR",
      groupExpr: "COALESCE(queue, 'unknown')",
    }))
    .with("group", () => {
      throw new Error("group grouping uses compileGroupFactsQuery");
    })
    .exhaustive();
}

/** Prematch rows have no champion_name column; label by id, like the fact engine. */
function prematchGrouping(groupBy: ReportGroupBy): Grouping {
  const base = matchGrouping(groupBy);
  if (groupBy === "champion") {
    return { ...base, labelExpr: "any_value(champion_id::VARCHAR)" };
  }
  return base;
}

function timePredicate(
  column: "game_creation_at" | "observed_at",
  startMs: number,
  endMs: number,
): SqlFragment {
  return {
    sql: `epoch_ms(${column}) BETWEEN ? AND ?`,
    params: [scalarParam(startMs), scalarParam(endMs)],
  };
}

function combinePredicates(fragments: SqlFragment[]): SqlFragment {
  const nonEmpty = fragments.filter((fragment) => fragment.sql.length > 0);
  return {
    sql: nonEmpty.map((fragment) => fragment.sql).join(" AND "),
    params: nonEmpty.flatMap((fragment) => fragment.params),
  };
}

function queuePredicate(queueFilter: string[] | undefined): SqlFragment {
  if (queueFilter === undefined) {
    return { sql: "", params: [] };
  }
  return {
    sql: "queue IN (SELECT unnest(?))",
    params: [listParam(queueFilter)],
  };
}

function championPredicate(championId: number | undefined): SqlFragment {
  if (championId === undefined) {
    return { sql: "", params: [] };
  }
  return { sql: "champion_id = ?", params: [scalarParam(championId)] };
}

const MATCH_FACT_COLUMNS =
  "a.player_id, a.player_alias, a.discord_id, m.match_id, m.team_id, " +
  "m.player_subteam_id, m.puuid, " +
  "m.champion_id, m.champion_name, m.queue, m.win, m.surrendered, m.kills, " +
  "m.deaths, m.assists, m.creep_score, m.total_damage_dealt_to_champions, " +
  "m.gold_earned, m.vision_score, m.total_damage_taken, m.total_damage_dealt, " +
  "m.wards_placed, m.double_kills, m.triple_kills, m.quadra_kills, " +
  "m.penta_kills, m.game_duration_seconds, m.time_played";

type FactsCte = SqlFragment;

function buildMatchFactsCte(
  input: LakeQueryInput,
  matchesSource: SqlFragment,
): FactsCte {
  const accounts = buildAccountsSource(
    requireAccounts(input.files),
    input.serverId,
  );
  const emptyScope: SqlFragment = { sql: "", params: [] };
  const playerScope: SqlFragment =
    input.playerIds === undefined
      ? emptyScope
      : {
          sql: " WHERE a.player_id IN (SELECT unnest(?))",
          params: [listParam(input.playerIds)],
        };
  return {
    sql:
      `WITH accounts AS (${accounts.sql}), ` +
      `facts AS (SELECT ${MATCH_FACT_COLUMNS} FROM (${matchesSource.sql}) m ` +
      `JOIN accounts a ON a.puuid = m.puuid${playerScope.sql})`,
    params: [
      ...accounts.params,
      ...matchesSource.params,
      ...playerScope.params,
    ],
  };
}

function requireAccounts(files: LakeFiles): string {
  if (files.accountsParquet === undefined) {
    throw new Error(
      "compile called without accounts.parquet — caller must short-circuit",
    );
  }
  return files.accountsParquet;
}

function scannedStatement(facts: FactsCte): {
  scannedSql: string;
  scannedParams: BoundParam[];
} {
  return {
    scannedSql: `${facts.sql} SELECT COUNT(*)::BIGINT AS scanned FROM facts`,
    scannedParams: facts.params,
  };
}

/** match_participants / competition_match_participants. */
export function compileMatchQuery(
  input: LakeQueryInput,
): CompiledLakeQuery | undefined {
  const predicate = combinePredicates([
    timePredicate("game_creation_at", input.startMs, input.endMs),
    queuePredicate(input.plan.queueFilter),
    championPredicate(input.plan.championId),
  ]);
  const matchesSource = buildMatchesSource(input.files, predicate);
  if (
    matchesSource === undefined ||
    input.files.accountsParquet === undefined
  ) {
    return undefined;
  }
  const facts = buildMatchFactsCte(input, matchesSource);
  const grouping = matchGrouping(input.plan.groupBy);
  return {
    aggregateSql:
      `${facts.sql} SELECT ${grouping.labelExpr} AS label, ` +
      `${grouping.discordExpr} AS discord_id, ${matchAggregateSelect()} ` +
      `FROM facts GROUP BY ${grouping.groupExpr}`,
    aggregateParams: facts.params,
    ...scannedStatement(facts),
  };
}

/**
 * player_groups: raw per-player fact rows for teammate-group units holding
 * ≥2 tracked players. The group unit is (match, team, subteam) — Arena's
 * team_id is a whole 100/200 side spanning several unrelated 2-3 player
 * subteams, so player_subteam_id (NULL outside Arena) scopes the unit.
 * Combination generation + stat summation happen in JS
 * (reports/group-combinations.ts): the group size is plan-driven, which the
 * static-SQL SELECT rule cannot express.
 */
export function compileGroupFactsQuery(
  input: LakeQueryInput,
): CompiledLakeQuery | undefined {
  const predicate = combinePredicates([
    timePredicate("game_creation_at", input.startMs, input.endMs),
    queuePredicate(input.plan.queueFilter),
    championPredicate(input.plan.championId),
  ]);
  const matchesSource = buildMatchesSource(input.files, predicate);
  if (
    matchesSource === undefined ||
    input.files.accountsParquet === undefined
  ) {
    return undefined;
  }
  const facts = buildMatchFactsCte(input, matchesSource);
  // One row per (match, team, subteam, player): when a player has two
  // tracked accounts in one match, keep a deterministic one (lowest puuid).
  // The fact engine kept the last-processed fact; pinned as an accepted
  // difference in the parity suite.
  const dedupe =
    "deduped AS (SELECT * FROM facts QUALIFY row_number() OVER " +
    "(PARTITION BY match_id, team_id, player_subteam_id, player_id ORDER BY puuid) = 1)";
  return {
    aggregateSql:
      `${facts.sql}, ${dedupe} ` +
      `SELECT ${groupFactSelect()} FROM deduped ` +
      `QUALIFY count(*) OVER ` +
      `(PARTITION BY match_id, team_id, player_subteam_id) >= 2`,
    aggregateParams: facts.params,
    ...scannedStatement(facts),
  };
}

/** prematch_participants: spectator observations; stats are 0 by design. */
export function compilePrematchQuery(
  input: LakeQueryInput,
): CompiledLakeQuery | undefined {
  // Champion filter deliberately NOT in the source predicate: rowsScanned
  // counts pre-champion-filter rows for this source (legacy parity).
  const predicate = combinePredicates([
    timePredicate("observed_at", input.startMs, input.endMs),
    queuePredicate(input.plan.queueFilter),
  ]);
  const prematchSource = buildPrematchSource(input.files, predicate);
  if (
    prematchSource === undefined ||
    input.files.accountsParquet === undefined
  ) {
    return undefined;
  }
  const accounts = buildAccountsSource(
    requireAccounts(input.files),
    input.serverId,
  );
  const factsSql =
    `WITH accounts AS (${accounts.sql}), ` +
    `facts AS (SELECT a.player_id, a.player_alias, a.discord_id, ` +
    `p.champion_id, p.queue FROM (${prematchSource.sql}) p ` +
    `JOIN accounts a ON a.puuid = p.puuid)`;
  const factsParams = [...accounts.params, ...prematchSource.params];

  const champion = championPredicate(input.plan.championId);
  const aggregateWhere =
    champion.sql.length > 0 ? ` WHERE ${champion.sql}` : "";
  const grouping = prematchGrouping(input.plan.groupBy);
  return {
    aggregateSql:
      `${factsSql} SELECT ${grouping.labelExpr} AS label, ` +
      `${grouping.discordExpr} AS discord_id, ${prematchAggregateSelect()} ` +
      `FROM facts${aggregateWhere} GROUP BY ${grouping.groupExpr}`,
    aggregateParams: [...factsParams, ...champion.params],
    scannedSql: `${factsSql} SELECT COUNT(*)::BIGINT AS scanned FROM facts`,
    scannedParams: factsParams,
  };
}
