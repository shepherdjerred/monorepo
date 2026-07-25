import type {
  ReportFilter,
  ReportFilterField,
  ReportGroupBy,
  ReportQueryPlan,
} from "@scout-for-lol/data";
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
  groupExprs: string[];
};

function singleMatchGrouping(groupBy: ReportGroupBy): Grouping {
  return match(groupBy)
    .with("player", () => ({
      labelExpr: "any_value(player_alias)",
      discordExpr: "any_value(discord_id)",
      groupExprs: ["player_id"],
    }))
    .with("champion", () => ({
      labelExpr: "any_value(champion_name)",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["champion_id"],
    }))
    .with("queue", () => ({
      labelExpr: "COALESCE(queue, 'unknown')",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["COALESCE(queue, 'unknown')"],
    }))
    .with("team_position", () => textGrouping("team_position"))
    .with("individual_position", () => textGrouping("individual_position"))
    .with("lane", () => textGrouping("lane"))
    .with("role", () => textGrouping("role"))
    .with("game_mode", () => textGrouping("game_mode"))
    .with("game_type", () => textGrouping("game_type"))
    .with("patch", () => ({
      labelExpr: String.raw`regexp_extract(any_value(game_version), '^[0-9]+\.[0-9]+')`,
      discordExpr: "NULL::VARCHAR",
      groupExprs: [String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`],
    }))
    .with("map", () => ({
      labelExpr: "any_value(map_id)::VARCHAR",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["map_id"],
    }))
    .with("outcome", () => ({
      labelExpr: "CASE WHEN win THEN 'Win' ELSE 'Loss' END",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["win"],
    }))
    .with("surrender_state", () => ({
      labelExpr:
        "CASE WHEN early_surrendered THEN 'Early surrender' WHEN surrendered THEN 'Surrender' ELSE 'Played out' END",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["early_surrendered", "surrendered"],
    }))
    .with("arena_placement", () => ({
      labelExpr: "COALESCE(placement::VARCHAR, 'Not Arena')",
      discordExpr: "NULL::VARCHAR",
      groupExprs: ["placement"],
    }))
    .with("day", () => timeGrouping("day", "%Y-%m-%d"))
    .with("week", () => timeGrouping("week", "%Y-%m-%d"))
    .with("month", () => timeGrouping("month", "%Y-%m"))
    .with("all", () => ({
      labelExpr: "'All'",
      discordExpr: "NULL::VARCHAR",
      groupExprs: [],
    }))
    .with("group", () => {
      throw new Error("group grouping uses compileGroupFactsQuery");
    })
    .exhaustive();
}

function textGrouping(column: string): Grouping {
  const expression = `COALESCE(${column}, 'unknown')`;
  return {
    labelExpr: `any_value(${expression})`,
    discordExpr: "NULL::VARCHAR",
    groupExprs: [expression],
  };
}

function timeGrouping(
  unit: "day" | "week" | "month",
  format: string,
): Grouping {
  const expression = `date_trunc('${unit}', game_creation_at)`;
  return {
    labelExpr: `strftime(any_value(${expression}), '${format}')`,
    discordExpr: "NULL::VARCHAR",
    groupExprs: [expression],
  };
}

function matchGrouping(groupBys: ReportGroupBy[]): Grouping {
  const groupings = groupBys.map((groupBy) => singleMatchGrouping(groupBy));
  const labels = groupings.map((grouping) => grouping.labelExpr);
  return {
    labelExpr:
      labels.length === 1
        ? (labels[0] ?? "'All'")
        : `concat_ws(' • ', ${labels.join(", ")})`,
    discordExpr: groupBys.includes("player")
      ? "any_value(discord_id)"
      : "NULL::VARCHAR",
    groupExprs: groupings.flatMap((grouping) => grouping.groupExprs),
  };
}

/** Prematch rows have no champion_name column; label by id, like the fact engine. */
function prematchGrouping(groupBy: ReportGroupBy): Grouping {
  const base = singleMatchGrouping(groupBy);
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

function filterColumn(field: ReportFilterField): string {
  return match(field)
    .with("player", () => "player_alias")
    .with("champion_id", () => "champion_id")
    .with("queue", () => "queue")
    .with("team_position", () => "team_position")
    .with("individual_position", () => "individual_position")
    .with("lane", () => "lane")
    .with("role", () => "role")
    .with("game_mode", () => "game_mode")
    .with("game_type", () => "game_type")
    .with("game_version", () => "game_version")
    .with("map_id", () => "map_id")
    .with("win", () => "win")
    .with("surrendered", () => "surrendered")
    .with("early_surrendered", () => "early_surrendered")
    .with("first_blood_kill", () => "first_blood_kill")
    .with("game_duration_seconds", () => "game_duration_seconds")
    .with("placement", () => "placement")
    .with("kills", () => "kills")
    .with("deaths", () => "deaths")
    .with("assists", () => "assists")
    .with("creep_score", () => "creep_score")
    .with("gold_earned", () => "gold_earned")
    .with("gold_spent", () => "gold_spent")
    .with("damage_to_champions", () => "total_damage_dealt_to_champions")
    .with("vision_score", () => "vision_score")
    .exhaustive();
}

function genericPredicate(
  filters: ReportFilter[],
  includePlayer: boolean,
): SqlFragment {
  const fragments = filters
    .filter((filter) => (filter.field === "player") === includePlayer)
    .map((filter): SqlFragment => {
      const rawColumn = filterColumn(filter.field);
      const isString = typeof filter.values[0] === "string";
      const column = isString ? `lower(${rawColumn})` : rawColumn;
      if (filter.operator === "in") {
        const values = filter.values;
        if (values.every((value) => typeof value === "string")) {
          return {
            sql: `${column} IN (SELECT unnest(?))`,
            params: [listParam(values)],
          };
        }
        if (values.every((value) => typeof value === "number")) {
          return {
            sql: `${column} IN (SELECT unnest(?))`,
            params: [listParam(values)],
          };
        }
        if (values.every((value) => typeof value === "boolean")) {
          return {
            sql: `(${values.map(() => `${column} = ?`).join(" OR ")})`,
            params: values.map((value) => scalarParam(value)),
          };
        }
        throw new Error(`Filter ${filter.field} has mixed value types.`);
      }
      const value = filter.values[0];
      if (value === undefined) {
        throw new Error(`Filter ${filter.field} has no value.`);
      }
      return {
        sql: `${column} ${filter.operator} ?`,
        params: [scalarParam(value)],
      };
    });
  return combinePredicates(fragments);
}

const MATCH_FACT_COLUMNS =
  "a.player_id, a.player_alias, a.discord_id, m.match_id, m.team_id, " +
  "m.player_subteam_id, m.puuid, " +
  "m.champion_id, m.champion_name, m.queue, m.team_position, " +
  "m.individual_position, m.lane, m.role, m.game_mode, m.game_type, " +
  "m.game_version, m.map_id, m.game_creation_at, m.win, m.surrendered, " +
  "m.early_surrendered, m.kills, " +
  "m.deaths, m.assists, m.creep_score, m.total_damage_dealt_to_champions, " +
  "m.gold_earned, m.vision_score, m.total_damage_taken, m.total_damage_dealt, " +
  "m.wards_placed, m.double_kills, m.triple_kills, m.quadra_kills, " +
  "m.penta_kills, m.game_duration_seconds, m.time_played, " +
  "m.total_minions_killed, m.neutral_minions_killed, m.gold_spent, " +
  "m.damage_self_mitigated, m.damage_dealt_to_objectives, " +
  "m.damage_dealt_to_turrets, m.total_heal, m.total_heals_on_teammates, " +
  "m.wards_killed, m.vision_wards_bought_in_game, m.detector_wards_placed, " +
  "m.largest_multi_kill, m.killing_sprees, m.first_blood_kill, " +
  "m.champ_level, m.champ_experience, m.total_time_spent_dead, " +
  "m.longest_time_spent_living, m.time_ccing_others, m.turret_kills, " +
  "m.inhibitor_kills, m.dragon_kills, m.baron_kills, m.placement";

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
  const playerIdScope: SqlFragment =
    input.playerIds === undefined
      ? emptyScope
      : {
          sql: "a.player_id IN (SELECT unnest(?))",
          params: [listParam(input.playerIds)],
        };
  const playerFilter = genericPredicate(input.plan.filters, true);
  const factScope = combinePredicates([playerIdScope, playerFilter]);
  const factWhere = factScope.sql.length === 0 ? "" : ` WHERE ${factScope.sql}`;
  return {
    sql:
      `WITH accounts AS (${accounts.sql}), ` +
      `facts AS (SELECT ${MATCH_FACT_COLUMNS} FROM (${matchesSource.sql}) m ` +
      `JOIN accounts a ON a.puuid = m.puuid${factWhere})`,
    params: [...accounts.params, ...matchesSource.params, ...factScope.params],
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
    genericPredicate(input.plan.filters, false),
  ]);
  const matchesSource = buildMatchesSource(input.files, predicate);
  if (
    matchesSource === undefined ||
    input.files.accountsParquet === undefined
  ) {
    return undefined;
  }
  const facts = buildMatchFactsCte(input, matchesSource);
  const grouping = matchGrouping(input.plan.groupBys);
  const groupBySql =
    grouping.groupExprs.length === 0
      ? " HAVING COUNT(*) > 0"
      : ` GROUP BY ${grouping.groupExprs.join(", ")}`;
  return {
    aggregateSql:
      `${facts.sql} SELECT ${grouping.labelExpr} AS label, ` +
      `${grouping.discordExpr} AS discord_id, ${matchAggregateSelect()} ` +
      `FROM facts${groupBySql}`,
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
    genericPredicate(input.plan.filters, false),
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
    genericPredicate(input.plan.filters, false),
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
  const groupBySql =
    grouping.groupExprs.length === 0
      ? " HAVING COUNT(*) > 0"
      : ` GROUP BY ${grouping.groupExprs.join(", ")}`;
  return {
    aggregateSql:
      `${factsSql} SELECT ${grouping.labelExpr} AS label, ` +
      `${grouping.discordExpr} AS discord_id, ${prematchAggregateSelect()} ` +
      `FROM facts${aggregateWhere}${groupBySql}`,
    aggregateParams: [...factsParams, ...champion.params],
    scannedSql: `${factsSql} SELECT COUNT(*)::BIGINT AS scanned FROM facts`,
    scannedParams: factsParams,
  };
}
