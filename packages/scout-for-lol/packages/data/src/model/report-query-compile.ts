import { z } from "zod";
import {
  ReportMetricSchema,
  ReportGroupBySchema,
  ReportHavingOperatorSchema,
  ReportOrderBySchema,
  ReportOrderDirectionSchema,
  ReportQueryPlanSchema,
  ReportSourceSchema,
  type ReportGroupBy,
  type ReportGroupSize,
  type ReportHavingClause,
  type ReportMetric,
  type ReportFilter,
  type ReportQueryAst,
  type ReportQueryPlan,
} from "#src/model/report-query-spec.ts";
import {
  collectExpressionMetrics,
  parseReportSelectItem,
} from "#src/model/report-query-expression.ts";
import { parseRenderClause } from "#src/model/report-query-render.ts";
import {
  INVALID_QUERY_MESSAGE,
  parseReportQuery,
} from "#src/model/report-query-parser.ts";
import { compileReportWhere } from "#src/model/report-query-where.ts";
import {
  parseTemporalAnalysisClause,
  resolveTemporalBucket,
  temporalWindowDays,
} from "#src/model/temporal-analysis.ts";
import { REPORT_METRICS } from "#src/model/report-query-metrics.ts";

const PositiveIntSchema = z.coerce.number().int().positive();

// The parsed `GROUP BY` clause value: the grouping field plus, for teammate
// groups, the requested size. `pair` is the legacy alias for `group(2)`.
export type ReportGroupByClause = {
  groupBy: ReportGroupBy;
  groupSize?: ReportGroupSize;
};

const INVALID_GROUP_BY_MESSAGE =
  "Unknown GROUP BY field. Valid fields: player, champion, queue, group(2..5), group(all), pair.";

// The parser joins the GROUP BY tokens with single spaces (e.g. `group(3)`
// lexes to `group ( 3 )`), so the call form is matched on that shape.
const GROUP_CALL_PATTERN = /^group\s*\(\s*(?<size>\d+|all)\s*\)$/u;

/**
 * Parse raw `GROUP BY` clause text (lowercased, whitespace-collapsed) into the
 * structured grouping. Returns undefined for unknown fields — shared by the
 * compiler (which throws) and the linter (which emits a diagnostic).
 */
export function parseGroupByClause(
  value: string,
): ReportGroupByClause | undefined {
  const parsed = ReportGroupBySchema.safeParse(value);
  if (parsed.success && parsed.data !== "group") {
    return { groupBy: parsed.data };
  }
  if (value === "pair") {
    return { groupBy: "group", groupSize: 2 };
  }
  const call = GROUP_CALL_PATTERN.exec(value);
  const size = call?.groups?.["size"];
  if (size === undefined) {
    return undefined;
  }
  if (size === "all") {
    return { groupBy: "group", groupSize: "all" };
  }
  const numeric = Number(size);
  if (numeric < 2 || numeric > 5) {
    return undefined;
  }
  return { groupBy: "group", groupSize: numeric };
}

export function parseGroupByClauses(value: string): ReportGroupByClause[] {
  const clauses = splitTopLevel(value).map((part) => parseGroupByClause(part));
  if (clauses.includes(undefined)) {
    throw new Error(INVALID_GROUP_BY_MESSAGE);
  }
  return clauses.flatMap((clause) => (clause === undefined ? [] : [clause]));
}

// SELECT-list names that refer to the grouping ("label") column rather than a
// metric. Group queries accept `group` plus the legacy `pair` alias.
export function groupingColumnNames(groupBy: ReportGroupBy): Set<string> {
  return groupBy === "group"
    ? new Set(["label", "group", "pair"])
    : new Set(["label", groupBy]);
}

// Compiles a parsed AST into the strict ReportQueryPlan the executor runs.
// Throws (zod or Error) on any invalid value — same contract as the original
// parseReportQuery.
export function compileReportQuery(ast: ReportQueryAst): ReportQueryPlan {
  if (ast.source === undefined || ast.groupBy === undefined) {
    throw new Error(INVALID_QUERY_MESSAGE);
  }

  // `player_pairs` is the legacy alias for `player_groups`; plans always
  // carry the canonical id so the engine matches one source.
  const rawSource = ReportSourceSchema.parse(ast.source.value);
  const source = rawSource === "player_pairs" ? "player_groups" : rawSource;
  const groupByClauses = parseGroupByClauses(ast.groupBy.value);
  if (groupByClauses.length === 0 || groupByClauses.length > 2) {
    throw new Error("GROUP BY requires one or two dimensions.");
  }
  const groupByClause = groupByClauses[0];
  if (groupByClause === undefined) throw new Error(INVALID_GROUP_BY_MESSAGE);
  const { groupBy: requestedGroupBy, groupSize } = groupByClause;
  const requestedGroupBys = groupByClauses.map((clause) => clause.groupBy);
  validateSourceDimensions(source, requestedGroupBys);
  const { analysis, bucket, groupBy, groupBys } = resolveTemporalGrouping(
    ast,
    source,
    requestedGroupBy,
    requestedGroupBys,
  );
  const labelNames = new Set(
    groupBys.flatMap((dimension) => [...groupingColumnNames(dimension)]),
  );
  const { metrics, outputKeys, selectItems } = compileSelection(
    ast,
    labelNames,
  );
  validateSourceMetrics(source, metrics);

  const filters = compileReportWhere(ast.where, source);
  validateSourceFilters(source, filters.filters);

  const { orderBy, orderDirection } = compileOrdering(
    ast,
    labelNames,
    outputKeys,
  );
  const limit =
    ast.limit === undefined
      ? analysis === undefined
        ? undefined
        : 2000
      : PositiveIntSchema.parse(ast.limit.value);

  const having = compileReportHaving(ast.having?.value, outputKeys);
  const render = parseRenderClause(
    ast.render?.value,
    outputKeys,
    groupBys,
    requestedGroupBys,
  );
  validateTemporalRender(render, metrics, analysis, bucket);

  return ReportQueryPlanSchema.parse({
    source,
    groupBy,
    groupBys,
    groupSize,
    metrics,
    selectItems,
    queueFilter: filters.queueFilter,
    championId: filters.championId,
    minGames: filters.minGames,
    competitionId: filters.competitionId,
    lookbackDays: filters.lookbackDays,
    analysis,
    filters: filters.filters,
    orderBy,
    orderDirection,
    having,
    limit,
    render,
  });
}

function resolveTemporalGrouping(
  ast: ReportQueryAst,
  source: ReportQueryPlan["source"],
  requestedGroupBy: ReportGroupBy,
  requestedGroupBys: ReportGroupBy[],
): Pick<ReportQueryPlan, "analysis" | "groupBy" | "groupBys"> & {
  bucket: ReportGroupBy | undefined;
} {
  const analysis =
    ast.analysis === undefined
      ? undefined
      : parseTemporalAnalysisClause(ast.analysis.value);
  validateTemporalCompatibility(ast, requestedGroupBys, analysis);
  if (
    analysis !== undefined &&
    (source === "rank_current" || source === "competition_rank")
  ) {
    throw new Error(
      `ANALYZE is not available for ${source}; use competition rank history analysis instead.`,
    );
  }
  if (analysis === undefined) {
    return {
      analysis,
      bucket: undefined,
      groupBy: requestedGroupBy,
      groupBys: requestedGroupBys,
    };
  }

  const bucket = resolveTemporalBucket(
    analysis.bucket,
    temporalWindowDays(analysis.window),
  );
  return {
    analysis,
    bucket,
    groupBy: requestedGroupBy === "all" ? bucket : requestedGroupBy,
    groupBys: requestedGroupBys.includes("all")
      ? [bucket]
      : [...requestedGroupBys, bucket],
  };
}

function compileSelection(
  ast: ReportQueryAst,
  labelNames: Set<string>,
): Pick<ReportQueryPlan, "metrics" | "selectItems"> & {
  outputKeys: string[];
} {
  const selectItems = ast.select
    .filter((item) => !labelNames.has(item.value))
    .map((item) => parseReportSelectItem(item.value));
  if (selectItems.length === 0 || selectItems.length > 20) {
    throw new Error("SELECT must contain between 1 and 20 metric outputs.");
  }
  const outputKeys = selectItems.map((item) => item.key);
  if (new Set(outputKeys).size !== outputKeys.length) {
    throw new Error("SELECT output aliases must be unique.");
  }
  const metrics = z
    .array(ReportMetricSchema)
    .min(1)
    .parse([
      ...new Set(
        selectItems.flatMap((item) =>
          collectExpressionMetrics(item.expression),
        ),
      ),
    ]);
  return { metrics, outputKeys, selectItems };
}

function compileOrdering(
  ast: ReportQueryAst,
  labelNames: Set<string>,
  outputKeys: string[],
): Pick<ReportQueryPlan, "orderBy" | "orderDirection"> {
  // Group dimensions canonicalize to `label`, matching SELECT and RENDER x.
  const orderBy =
    ast.orderBy === undefined
      ? "games"
      : labelNames.has(ast.orderBy.metric.value)
        ? "label"
        : ReportOrderBySchema.parse(ast.orderBy.metric.value);
  if (
    orderBy !== "label" &&
    orderBy !== "games" &&
    !outputKeys.includes(orderBy)
  ) {
    throw new Error(`ORDER BY target "${orderBy}" is not a SELECT output.`);
  }
  const orderDirection =
    ast.orderBy?.direction === undefined
      ? "desc"
      : ReportOrderDirectionSchema.parse(ast.orderBy.direction.value);
  return { orderBy, orderDirection };
}

const LEGACY_TEMPORAL_GROUPS = new Set<ReportGroupBy>([
  "day",
  "week",
  "month",
  "patch",
]);

function validateTemporalCompatibility(
  ast: ReportQueryAst,
  groupBys: ReportGroupBy[],
  analysis: ReportQueryPlan["analysis"],
): void {
  if (analysis === undefined) return;
  if (ast.where.some((clause) => clause.kind === "lookback")) {
    throw new Error(
      "Do not combine ANALYZE with a legacy timestamp lookback predicate.",
    );
  }
  if (groupBys.some((groupBy) => LEGACY_TEMPORAL_GROUPS.has(groupBy))) {
    throw new Error(
      "Do not combine ANALYZE with a temporal GROUP BY dimension; use BUCKET BY instead.",
    );
  }
  if (groupBys.length + (groupBys.includes("all") ? 0 : 1) > 3) {
    throw new Error("Temporal queries support at most two series dimensions.");
  }
}

function validateTemporalRender(
  render: ReportQueryPlan["render"],
  metrics: ReportMetric[],
  analysis: ReportQueryPlan["analysis"],
  bucket: ReportGroupBy | undefined,
): void {
  if (!("options" in render) || !("encoding" in render)) return;
  if (render.options.cumulative === true) {
    const kinds = new Map(
      REPORT_METRICS.map((metric) => [metric.id, metric.kind]),
    );
    const nonAdditive = metrics.find((metric) => kinds.get(metric) !== "count");
    if (nonAdditive !== undefined) {
      throw new Error(
        `Cumulative transforms require additive metrics; ${nonAdditive} is not additive.`,
      );
    }
  }
  if (
    render.options.stack === "percent" &&
    render.kind !== "STACKED_BAR" &&
    render.kind !== "AREA_CHART"
  ) {
    throw new Error(
      "Percentage stacking is only available for stacked bar and area charts.",
    );
  }
  if (analysis === undefined && render.kind === "BUMP_CHART") {
    throw new Error("Bump charts require an ANALYZE clause.");
  }
  if (bucket !== "day" && render.kind === "CALENDAR_HEATMAP") {
    throw new Error("Calendar heatmaps require BUCKET BY DAY.");
  }
}

function validateSourceDimensions(
  source: ReportQueryPlan["source"],
  groupBys: ReportGroupBy[],
): void {
  const allowed =
    source === "player_groups"
      ? new Set<ReportGroupBy>(["group"])
      : source === "rank_current" || source === "competition_rank"
        ? new Set<ReportGroupBy>(["player"])
        : source === "prematch_participants"
          ? new Set<ReportGroupBy>(["player", "champion", "queue", "all"])
          : new Set(
              ReportGroupBySchema.options.filter((value) => value !== "group"),
            );
  for (const groupBy of groupBys) {
    if (!allowed.has(groupBy)) {
      throw new Error(`GROUP BY ${groupBy} is not available for ${source}.`);
    }
  }
}

function validateSourceMetrics(
  source: ReportQueryPlan["source"],
  metrics: ReportMetric[],
): void {
  const allowed =
    source === "rank_current" || source === "competition_rank"
      ? new Set<ReportMetric>(["score"])
      : source === "prematch_participants"
        ? new Set(
            ReportMetricSchema.options.filter((metric) => metric !== "score"),
          )
        : new Set(
            ReportMetricSchema.options.filter(
              (metric) => metric !== "prematches" && metric !== "score",
            ),
          );
  for (const metric of metrics) {
    if (!allowed.has(metric)) {
      throw new Error(`Metric ${metric} is not available for ${source}.`);
    }
  }
}

function validateSourceFilters(
  source: ReportQueryPlan["source"],
  filters: ReportFilter[],
): void {
  const prematchFields = new Set([
    "player",
    "champion_id",
    "queue",
    "game_mode",
    "game_type",
    "map_id",
  ]);
  for (const filter of filters) {
    const valid =
      source === "rank_current" || source === "competition_rank"
        ? false
        : source !== "prematch_participants" ||
          prematchFields.has(filter.field);
    if (!valid) {
      throw new Error(`Filter ${filter.field} is not available for ${source}.`);
    }
  }
}

export function compileReportHaving(
  text: string | undefined,
  outputKeys: string[],
): ReportHavingClause[] {
  if (text === undefined || text.length === 0) return [];
  return text.split(/\s+and\s+/u).map((clause) => {
    const result =
      /^(?<key>[a-z_]\w*)\s*(?<operator>[!><]=|[=><])\s*(?<value>-?\d+(?:\.\d+)?)$/u.exec(
        clause.trim(),
      );
    if (result?.groups === undefined) {
      throw new Error(`Invalid HAVING clause "${clause}".`);
    }
    const key = result.groups["key"] ?? "";
    if (!outputKeys.includes(key)) {
      throw new Error(`HAVING target "${key}" is not a SELECT output.`);
    }
    return {
      key,
      operator: ReportHavingOperatorSchema.parse(result.groups["operator"]),
      value: Number(result.groups["value"]),
    };
  });
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

// Parse + compile in one step. Throws on the first structural/unsupported
// diagnostic, then on any semantic (enum/number) violation during compile.
export function parseAndCompile(text: string): ReportQueryPlan {
  const { ast, diagnostics } = parseReportQuery(text);
  const firstError = diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (firstError !== undefined) {
    throw new Error(firstError.message);
  }
  return compileReportQuery(ast);
}
