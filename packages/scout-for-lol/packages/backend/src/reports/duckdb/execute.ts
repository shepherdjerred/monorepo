import type { DuckDBValue } from "@duckdb/node-api";
import { scoutQlSourceCatalog } from "@scout-for-lol/data/model/scoutql/catalog-columns.ts";
import type {
  ScoutQlGroupSize,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  compileGroupFactsProjection,
  compileScoutQlPlanQuery,
  type CompiledGroupFactsColumns,
  type PlanQueryInput,
} from "#src/reports/duckdb/compile-plan.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import { resolveLakeFiles, type BoundParam } from "#src/reports/duckdb/lake.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";
import type {
  CompiledOutputColumn,
  CompiledPlanColumns,
} from "#src/reports/duckdb/select-sql.ts";
import {
  groupFactRowSchema,
  LakeScannedRowSchema,
  optionalNumberField,
  optionalStringField,
  outputValueField,
  planRowSchema,
  requireField,
  requireNumberField,
  requireStringField,
  type LakeScalar,
  type PlanRowShape,
} from "#src/reports/duckdb/row-schema.ts";
import {
  aggregateFoldedGroups,
  foldGroupCombinations,
  type GroupFactRow,
} from "#src/reports/group-combinations.ts";
import type {
  PlanAggregateRow,
  PlanAggregationResult,
  PlanOutputEvidence,
  PlanOutputValue,
} from "#src/reports/plan-rows.ts";

/**
 * Execute a compiled ScoutQL v2 plan against the report lake.
 *
 * Aggregation, HAVING, ORDER BY and LIMIT all run in SQL — the JS layer no
 * longer derives metrics from a fixed counter table, because MEDIAN, QUANTILE
 * and COUNT(DISTINCT) cannot be computed from pre-summed counters at all. The
 * one exception is `player_groups`, whose unit (a k-subset of the tracked
 * players in one game) is not a relation DuckDB can group by; that path reads
 * raw participant facts and folds them in JS.
 */

export type PlanExecutionInput = {
  plan: ScoutQlPlan;
  scope: LakeQueryScope;
  range: { start: Date; end: Date };
  /** Effective row budget, already policy-capped by the caller. */
  limit: number;
  /** Resolved `player('…')` PUUIDs, by playerRefs index. */
  playerPuuids?: Map<number, string[]> | undefined;
  /** Guild-only pre-resolved player scoping (competition path). */
  playerIds?: number[] | undefined;
  lakeDir?: string | undefined;
};

const EMPTY_RESULT: PlanAggregationResult = { rows: [], rowsScanned: 0 };

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): DuckDBValue[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

async function queryInput(input: PlanExecutionInput): Promise<PlanQueryInput> {
  const files = await resolveLakeFiles(input.lakeDir ?? resolveLakeDir());
  return {
    plan: input.plan,
    scope: input.scope,
    files,
    range: input.range,
    limit: input.limit,
    playerPuuids: input.playerPuuids,
    ...(input.playerIds === undefined ? {} : { playerIds: input.playerIds }),
  };
}

export async function runPlanAggregation(
  input: PlanExecutionInput,
): Promise<PlanAggregationResult> {
  if (input.plan.source === "player_groups") {
    return await runGroupAggregation(input);
  }
  const compiled = compileScoutQlPlanQuery(await queryInput(input));
  if (compiled === undefined) {
    // Fresh install / empty lake / no competition participants: the answer is
    // structurally empty, exactly as "no facts yet".
    return EMPTY_RESULT;
  }
  const RowSchema = planRowSchema(compiled.columns);
  return await withDuckDBConnection(async (session) => {
    const rawRows = await session.run(
      compiled.aggregateSql,
      bindParams(session, compiled.aggregateParams),
    );
    const scannedRows = await session.run(
      compiled.scannedSql,
      bindParams(session, compiled.scannedParams),
    );
    return {
      rows: rawRows.map((row) =>
        planRowFrom(RowSchema.parse(row), compiled.columns),
      ),
      rowsScanned: scannedCount(scannedRows[0]),
    };
  });
}

function scannedCount(row: unknown): number {
  const scanned = LakeScannedRowSchema.parse(row).scanned;
  if (typeof scanned !== "number") {
    throw new TypeError("Scanned-row count is not numeric.");
  }
  return scanned;
}

function planRowFrom(
  row: PlanRowShape,
  columns: CompiledPlanColumns,
): PlanAggregateRow {
  return {
    label: requireStringField(row, columns.label),
    playerId: optionalNumberField(row, columns.playerId),
    discordId: optionalStringField(row, columns.discordId),
    keys: columns.groupingKeys.map((key) => requireField(row, key)),
    groupMembers: null,
    outputs: columns.outputs.map((output) => outputValueFrom(row, output)),
  };
}

function outputValueFrom(
  row: PlanRowShape,
  output: CompiledOutputColumn,
): PlanOutputValue {
  return {
    name: output.name,
    value: outputValueField(row, output.alias),
    evidence: evidenceFrom(row, output.evidence),
  };
}

function evidenceFrom(
  row: PlanRowShape,
  evidence: CompiledOutputColumn["evidence"],
): PlanOutputEvidence {
  if (evidence.kind === "rate") {
    return {
      kind: "rate",
      successes: requireNumberField(row, evidence.successes),
      trials: requireNumberField(row, evidence.trials),
    };
  }
  if (evidence.kind === "ratio") {
    return {
      kind: "ratio",
      numerator: requireNumberField(row, evidence.numerator),
      denominator: requireNumberField(row, evidence.denominator),
    };
  }
  return {
    kind: "sample",
    sampleCount: requireNumberField(row, evidence.sampleCount),
  };
}

// ── player_groups ────────────────────────────────────────────────────────────

/**
 * The columns a teammate group carries unchanged rather than summing. They are
 * exactly the catalog's WHERE-able columns for this source: game- and
 * team-level facts, identical for every member of one group unit.
 */
export function groupGameLevelColumns(): ReadonlySet<string> {
  const catalog = scoutQlSourceCatalog("player_groups");
  if (catalog === undefined) {
    throw new Error("unreachable: player_groups has no source catalog");
  }
  const names = new Set<string>();
  for (const column of catalog.columns.values()) {
    if (column.contexts.where) {
      names.add(column.name);
    }
  }
  return names;
}

function requireGroupSize(plan: ScoutQlPlan): ScoutQlGroupSize {
  const grouping = plan.groupings[0];
  if (grouping?.kind !== "group" || plan.groupings.length !== 1) {
    throw new Error("player_groups reports must GROUP BY group(...).");
  }
  return grouping.size;
}

async function runGroupAggregation(
  input: PlanExecutionInput,
): Promise<PlanAggregationResult> {
  const size = requireGroupSize(input.plan);
  const projection = compileGroupFactsProjection(await queryInput(input));
  if (projection === undefined) {
    return EMPTY_RESULT;
  }
  const RowSchema = groupFactRowSchema(projection.columns);
  const gameLevelColumns = groupGameLevelColumns();
  return await withDuckDBConnection(async (session) => {
    const rawRows = await session.run(
      projection.factsSql,
      bindParams(session, projection.factsParams),
    );
    const scannedRows = await session.run(
      projection.scannedSql,
      bindParams(session, projection.scannedParams),
    );
    const facts = rawRows.map((row) =>
      groupFactFrom(RowSchema.parse(row), projection.columns),
    );
    const groups = foldGroupCombinations({ facts, size, gameLevelColumns });
    return {
      rows: aggregateFoldedGroups({
        plan: input.plan,
        groups,
        gameLevelColumns,
        limit: input.limit,
      }),
      rowsScanned: scannedCount(scannedRows[0]),
    };
  });
}

function groupFactFrom(
  row: PlanRowShape,
  columns: CompiledGroupFactsColumns,
): GroupFactRow {
  const values = new Map<string, LakeScalar>(
    columns.raw.map((name: string) => [name, requireField(row, name)]),
  );
  return {
    playerId: requireNumberField(row, columns.playerId),
    playerAlias: requireStringField(row, columns.playerAlias),
    matchId: requireStringField(row, columns.matchId),
    teamId: requireNumberField(row, columns.teamId),
    playerSubteamId: optionalNumberField(row, columns.playerSubteamId),
    values,
  };
}
