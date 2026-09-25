import { match } from "ts-pattern";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { ScoutQlPredicate } from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import {
  buildMatchTeamBansSource,
  buildTimelineEventsSource,
  buildTimelineParticipantFramesSource,
  buildMatchTeamsSource,
  buildMatchesSource,
  buildPrematchSource,
  listParam,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";
import type {
  BoundParam,
  LakeFiles,
  SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import {
  isTrackedScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";
import type { ServerPerson } from "#src/reports/server-people.ts";
import {
  compilePredicate,
  predicateReadsOnly,
  predicateTouchesIdentity,
  type ExprContext,
} from "#src/reports/duckdb/expr-sql.ts";
import {
  TEAM_LOOKUP_COLUMNS,
  buildPlanColumnMap,
  EVENT_LOOKUPS,
  FIRST_OF_KIND_PARTITION,
  timeFromLookup,
  resolveColumn,
  type ColumnMap,
} from "#src/reports/duckdb/column-map.ts";
import {
  compilePlanGrouping,
  type CompiledGrouping,
} from "#src/reports/duckdb/group-sql.ts";
import {
  buildAggregateTail,
  type CompiledPlanColumns,
} from "#src/reports/duckdb/select-sql.ts";
import { buildFactsCte } from "#src/reports/duckdb/facts-cte.ts";
import { LOADOUT_NAME_DEPENDENCIES } from "#src/reports/duckdb/loadout-sql.ts";
import { LOADOUT_COLUMNS } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import {
  buildLookupSources,
  enforceScopeGuards,
  hasTrackedAccounts,
  planSourceKind,
  type EventLookupFlags,
  type SourceKind,
} from "#src/reports/duckdb/plan-source.ts";
import { combineAnd, frag, seq } from "#src/reports/duckdb/sql-fragment.ts";
import {
  enforcePlanNodeBudget,
  flattenConjuncts,
  referencedColumnNames,
} from "#src/reports/duckdb/plan-budget.ts";

/**
 * ScoutQL v2 plan → parameterized DuckDB SQL for lake-backed sources.
 *
 * Preserved from the legacy compiler, verbatim in structure:
 * - the two-branch parquet ∪ staging union with QUALIFY dedupe (lake.ts),
 *   with the range predicate and every identity-free top-level WHERE conjunct
 *   pushed into BOTH branches before the dedupe window;
 * - the guild accounts-join / global NO-join identity rules (global scope
 *   labels rows from the Riot ID already on the fact — re-adding the join
 *   would double-count accounts tracked by more than one server);
 * - the `usableSource` empty-lake short-circuit (returns undefined);
 * - competition scoping as engine-resolved playerIds, never SQL-side
 *   competition metadata.
 *
 * Deliberately dropped: the legacy prematch rowsScanned asymmetry. For every
 * source, scannedSql counts the fully filtered facts rows.
 */

export type CompiledPlanQuery = {
  aggregateSql: string;
  aggregateParams: BoundParam[];
  scannedSql: string;
  scannedParams: BoundParam[];
  columns: CompiledPlanColumns;
};

export type PlanQueryInput = {
  plan: ScoutQlPlan;
  scope: LakeQueryScope;
  files: LakeFiles;
  /** Resolved execution range (engine passes epoch..now for unbounded). */
  range: { start: Date; end: Date };
  /** Resolved `player('…')` PUUIDs by playerRefs index. */
  playerPuuids?: Map<number, string[]> | undefined;
  /** Guild-only pre-resolved player scoping (competition path). */
  playerIds?: number[] | undefined;
  /** The merged people of a `servers` scope; required there, unused elsewhere. */
  serverPeople?: readonly ServerPerson[] | undefined;
  /** Effective limit, already policy-capped. */
  limit: number;
};

type SplitWhere = {
  /** Identity-free conjuncts, pushed into both union branches. */
  pushed: ScoutQlPredicate[];
  /** Conjuncts touching identity columns — compiled against the facts CTE. */
  residual: ScoutQlPredicate[];
};

/** Loadout ids, which a scan selects only when a plan reads one. */
const LOADOUT: ReadonlySet<string> = new Set(LOADOUT_COLUMNS);

function splitWhere(
  where: ScoutQlPredicate | undefined,
  columns: ColumnMap,
): SplitWhere {
  if (where === undefined) {
    return { pushed: [], residual: [] };
  }
  const pushed: ScoutQlPredicate[] = [];
  const residual: ScoutQlPredicate[] = [];
  for (const conjunct of flattenConjuncts(where)) {
    if (predicateTouchesIdentity(conjunct, columns)) {
      residual.push(conjunct);
    } else {
      pushed.push(conjunct);
    }
  }
  return { pushed, residual };
}

function rangePredicate(
  timeColumn: "game_creation_at" | "observed_at",
  range: { start: Date; end: Date },
): SqlFragment {
  return frag(`epoch_ms(${timeColumn}) BETWEEN ? AND ?`, [
    scalarParam(range.start.getTime()),
    scalarParam(range.end.getTime()),
  ]);
}

/**
 * Resolve every referenced column and return the source columns the facts CTE
 * must project (identity columns are always projected separately).
 */
function projectionDependencies(
  referenced: Set<string>,
  columns: ColumnMap,
): Set<string> {
  const dependencies = new Set<string>();
  for (const name of referenced) {
    // Identity and looked-up columns are projected by the facts CTE itself,
    // but a column derived from one (kill participation) still reads source
    // columns, and those must be projected like any other.
    for (const dependency of resolveColumn(columns, name).dependencies) {
      dependencies.add(dependency);
    }
  }
  return dependencies;
}

type FactsPipeline = {
  /** CTE prefix ending after facts (and filtered, when present). */
  prefix: SqlFragment;
  relation: "facts" | "filtered";
};

function buildFactsPipeline(
  input: PlanQueryInput,
  kind: SourceKind,
  columns: ColumnMap,
  extras: {
    projected: Set<string>;
    extraItems: SqlFragment[];
    /** Join the team row for team_champion_kills / kill_participation. */
    teamLookup?: boolean;
    /** Compute gold differences against other frames of the same minute. */
    frameGold?: { team: boolean; lane: boolean } | undefined;
    /** Event lookups named by the plan. */
    eventLookups?: EventLookupFlags | undefined;
    /** A grouping keys on the player, so rows without one are dropped. */
    playerGrouped?: boolean;
    /** Loadout name columns the plan names. */
    loadoutNames?: ReadonlySet<string>;
  },
): FactsPipeline | undefined {
  const factsContext: ExprContext = {
    columns,
    placement: "facts",
    playerPuuids: input.playerPuuids,
  };
  const sourceContext: ExprContext = { ...factsContext, placement: "source" };

  const split = splitWhere(input.plan.where, columns);
  // The first-of-kind window must see its whole partition: only conjuncts that
  // select whole partitions are pushed; the rest apply to facts after it.
  const windowed = extras.eventLookups?.firstOfKind === true;
  const pushed = windowed
    ? split.pushed.filter((c) => predicateReadsOnly(c, FIRST_OF_KIND_PARTITION))
    : split.pushed;
  const residual = [
    ...split.pushed.filter((c) => !pushed.includes(c)),
    ...split.residual,
  ];
  const range = rangePredicate(kind.timeColumn, input.range);
  const pushedFragments = pushed.map((conjunct) =>
    compilePredicate(conjunct, sourceContext),
  );
  // Everywhere else the time window is pushed into the source's own scan. A
  // team row has no timestamp, so for match_teams the window belongs to the
  // match dimension the facts CTE joins, and only the team-side conjuncts are
  // pushed here.
  const pushdown = timeFromLookup(kind.columnSource)
    ? combineAnd(pushedFragments)
    : combineAnd([range, ...pushedFragments]);
  const source = match(kind.columnSource)
    .with("match", () =>
      buildMatchesSource(
        input.files,
        pushdown,
        [...extras.projected].filter((name) => LOADOUT.has(name)),
      ),
    )
    .with("prematch", () => buildPrematchSource(input.files, pushdown))
    .with("match-team", () => buildMatchTeamsSource(input.files, pushdown))
    .with("match-team-ban", () =>
      buildMatchTeamBansSource(input.files, pushdown),
    )
    .with("timeline-frame", () =>
      buildTimelineParticipantFramesSource(input.files, pushdown),
    )
    .with("timeline-event", () =>
      buildTimelineEventsSource(input.files, pushdown),
    )
    .exhaustive();
  if (source === undefined) {
    return undefined;
  }
  const lookups = buildLookupSources(input.files, kind, range, {
    ...extras,
    scanFiltered: pushdown.sql.length > 0,
  });
  if (lookups === undefined) {
    return undefined;
  }
  if (!hasTrackedAccounts(input)) {
    return undefined;
  }
  const facts = buildFactsCte({
    scope: input.scope,
    files: input.files,
    serverPeople: input.serverPeople,
    columnSource: kind.columnSource,
    source,
    ...lookups,
    loadoutNames: extras.loadoutNames,
    projected: [...extras.projected],
    extraItems: extras.extraItems,
  });

  const residualFragments = residual.map((conjunct) =>
    compilePredicate(conjunct, factsContext),
  );
  // A tower's or minion's kill has no player, so no row under GROUP BY player.
  if (extras.playerGrouped === true) {
    residualFragments.push(frag("puuid IS NOT NULL"));
  }
  if (input.playerIds !== undefined) {
    residualFragments.push(
      frag("player_id IN (SELECT unnest(?))", [listParam(input.playerIds)]),
    );
  }
  const residualWhere = combineAnd(residualFragments);
  if (residualWhere.sql.length === 0) {
    return { prefix: facts, relation: "facts" };
  }
  return {
    prefix: seq(
      facts,
      ", filtered AS (SELECT * FROM facts WHERE ",
      residualWhere,
      ")",
    ),
    relation: "filtered",
  };
}

export function compileScoutQlPlanQuery(
  input: PlanQueryInput,
): CompiledPlanQuery | undefined {
  const { plan } = input;
  enforcePlanNodeBudget(plan);
  const kind = planSourceKind(plan, false);
  enforceScopeGuards(input);
  if (input.playerIds?.length === 0) {
    // No competition participants: the answer is structurally empty.
    return undefined;
  }
  const columns = buildPlanColumnMap(kind.columnSource);

  const groupings: CompiledGrouping[] = plan.groupings.map((grouping) =>
    compilePlanGrouping({
      grouping,
      columns,
      scope: input.scope,
      source: kind.columnSource,
      timeColumn: kind.timeColumn,
      playerPuuids: input.playerPuuids,
    }),
  );

  const referenced = referencedColumnNames(plan);
  for (const grouping of groupings) {
    for (const name of grouping.columnNames) {
      referenced.add(name);
    }
  }
  const projected = projectionDependencies(referenced, columns);
  // The time column backs global arg_max labeling and date-trunc groupings;
  // puuid is always projected separately as `m.puuid AS puuid`. On match_teams
  // neither is a column of `m` — the time comes from the joined dimension and
  // there is no player — so nothing is added here.
  if (!timeFromLookup(kind.columnSource)) {
    projected.add(kind.timeColumn);
  }
  projected.delete("puuid");

  const pipeline = buildFactsPipeline(input, kind, columns, {
    projected,
    extraItems: [],
    playerGrouped: groupings.some((grouping) => grouping.playerIdentity),
    teamLookup:
      kind.columnSource === "match" &&
      [...referenced].some((name) => TEAM_LOOKUP_COLUMNS.has(name)),
    loadoutNames: new Set(
      [...referenced].filter((name) => LOADOUT_NAME_DEPENDENCIES.has(name)),
    ),
    frameGold:
      kind.columnSource === "timeline-frame"
        ? {
            team: referenced.has("team_gold_diff"),
            lane: referenced.has("lane_gold_diff"),
          }
        : undefined,
    eventLookups:
      kind.columnSource === "timeline-event"
        ? {
            firstOfKind: referenced.has(EVENT_LOOKUPS.firstOfKind),
            killerTeam: referenced.has(EVENT_LOOKUPS.killerTeamWon),
            assists:
              referenced.has(EVENT_LOOKUPS.assistCount) ||
              referenced.has(EVENT_LOOKUPS.soloKill),
          }
        : undefined,
  });
  if (pipeline === undefined) {
    return undefined;
  }

  const { tail, columns: planColumns } = buildAggregateTail({
    plan,
    columns,
    scope: input.scope,
    groupings,
    playerPuuids: input.playerPuuids,
    factsRelation: pipeline.relation,
    limit: input.limit,
  });

  const aggregate = seq(pipeline.prefix, " ", tail);
  const scanned = seq(
    pipeline.prefix,
    ` SELECT (COUNT(*))::BIGINT AS scanned FROM ${pipeline.relation}`,
  );
  return {
    aggregateSql: aggregate.sql,
    aggregateParams: aggregate.params,
    scannedSql: scanned.sql,
    scannedParams: scanned.params,
    columns: planColumns,
  };
}

// ── player_groups raw-fact projection ────────────────────────────────────────

export type CompiledGroupFactsColumns = {
  playerId: "player_id";
  playerAlias: "player_alias";
  discordId: "discord_id";
  puuid: "puuid";
  matchId: "match_id";
  teamId: "team_id";
  playerSubteamId: "player_subteam_id";
  /** Referenced value columns, projected under their catalog/virtual names. */
  raw: string[];
};

export type CompiledGroupFactsProjection = {
  factsSql: string;
  factsParams: BoundParam[];
  scannedSql: string;
  scannedParams: BoundParam[];
  columns: CompiledGroupFactsColumns;
};

const GROUP_UNIT_COLUMNS = [
  "match_id",
  "team_id",
  "player_subteam_id",
] as const;

/**
 * player_groups: raw per-player fact rows for teammate-group units holding
 * ≥2 tracked players, exactly as the legacy compileGroupFactsQuery scoped
 * them. The group unit is (match, team, subteam) — Arena's team_id is a whole
 * 100/200 side spanning several unrelated 2-3 player subteams, so
 * player_subteam_id (NULL outside Arena) scopes the unit. Combination
 * generation and aggregate folding happen in JS; this projection carries the
 * unit/identity columns plus only the value columns the plan references.
 */
export function compileGroupFactsProjection(
  input: PlanQueryInput,
): CompiledGroupFactsProjection | undefined {
  const { plan } = input;
  enforcePlanNodeBudget(plan);
  const kind = planSourceKind(plan, true);
  if (!isTrackedScope(input.scope)) {
    throw new Error(
      "player_groups is not available in global scope — teammate groups are " +
        "defined by tracked accounts queueing together, which global match " +
        "facts cannot distinguish from random matchmaking.",
    );
  }
  if (plan.groupings.length !== 1 || plan.groupings[0]?.kind !== "group") {
    throw new Error("player_groups requires exactly GROUP BY group(...).");
  }
  if (input.playerIds?.length === 0) {
    return undefined;
  }
  const columns = buildPlanColumnMap(kind.columnSource);

  const referenced = referencedColumnNames(plan);
  const teamLookup = [...referenced].find((name) =>
    TEAM_LOOKUP_COLUMNS.has(name),
  );
  if (teamLookup !== undefined) {
    throw new Error(
      `${teamLookup} is not available on player_groups: a group spans players, not one team row.`,
    );
  }
  const fixed = new Set<string>(["puuid", ...GROUP_UNIT_COLUMNS]);
  const rawNames: string[] = [];
  const projected = new Set<string>(GROUP_UNIT_COLUMNS);
  const extraItems: SqlFragment[] = [];
  for (const name of [...referenced].toSorted()) {
    const binding = resolveColumn(columns, name);
    if (binding.identity || fixed.has(name)) continue;
    rawNames.push(name);
    if (binding.sql === name) {
      projected.add(name);
    } else {
      // Virtual dimension: computed in the facts CTE under its own name, with
      // its source dependencies also projected for facts-context predicates.
      extraItems.push(frag(`(${binding.sql}) AS ${name}`));
      for (const dependency of binding.dependencies) {
        projected.add(dependency);
      }
    }
  }

  const pipeline = buildFactsPipeline(input, kind, columns, {
    projected,
    extraItems,
  });
  if (pipeline === undefined) {
    return undefined;
  }

  // One row per (match, team, subteam, player): when a player has two tracked
  // accounts in one match, keep a deterministic one (lowest puuid).
  const dedupe =
    ", deduped AS (SELECT * FROM " +
    pipeline.relation +
    " QUALIFY row_number() OVER (PARTITION BY match_id, team_id, player_subteam_id, player_id ORDER BY puuid) = 1)";
  const finalColumns = [
    "player_id",
    "player_alias",
    "discord_id",
    "puuid",
    ...GROUP_UNIT_COLUMNS,
    ...rawNames,
  ].join(", ");
  const facts = seq(
    pipeline.prefix,
    dedupe,
    ` SELECT ${finalColumns} FROM deduped QUALIFY count(*) OVER (PARTITION BY match_id, team_id, player_subteam_id) >= 2`,
  );
  const scanned = seq(
    pipeline.prefix,
    ` SELECT (COUNT(*))::BIGINT AS scanned FROM ${pipeline.relation}`,
  );
  return {
    factsSql: facts.sql,
    factsParams: facts.params,
    scannedSql: scanned.sql,
    scannedParams: scanned.params,
    columns: {
      playerId: "player_id",
      playerAlias: "player_alias",
      discordId: "discord_id",
      puuid: "puuid",
      matchId: "match_id",
      teamId: "team_id",
      playerSubteamId: "player_subteam_id",
      raw: rawNames,
    },
  };
}
