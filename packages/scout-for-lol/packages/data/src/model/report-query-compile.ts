import { match } from "ts-pattern";
import { z } from "zod";
import {
  ReportMetricSchema,
  ReportOrderBySchema,
  ReportOrderDirectionSchema,
  ReportQueryPlanSchema,
  ReportSourceSchema,
  type ReportGroupBy,
  type ReportGroupSize,
  type ReportMetric,
  type ReportQueryAst,
  type ReportQueryPlan,
  type ReportWhereClause,
} from "#src/model/report-query-spec.ts";
import {
  DEFAULT_RENDER_SPEC,
  ReportRenderSpecSchema,
  type ReportChartOptions,
  type ReportOutputFormat,
  type ReportRenderChannel,
  type ReportRenderSpec,
} from "#src/model/report.ts";
import {
  INVALID_QUERY_MESSAGE,
  parseReportQuery,
  UNSUPPORTED_WHERE_MESSAGE,
} from "#src/model/report-query-parser.ts";

const PositiveIntSchema = z.coerce.number().int().positive();

type WhereFilters = {
  queueFilter?: string[];
  championId?: number;
  minGames?: number;
  competitionId?: number;
};

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
  if (value === "player" || value === "champion" || value === "queue") {
    return { groupBy: value };
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
  const groupByClause = parseGroupByClause(ast.groupBy.value);
  if (groupByClause === undefined) {
    throw new Error(INVALID_GROUP_BY_MESSAGE);
  }
  const { groupBy, groupSize } = groupByClause;
  const labelNames = groupingColumnNames(groupBy);
  const metrics = z
    .array(ReportMetricSchema)
    .min(1)
    .parse(
      ast.select
        .map((item) => item.value)
        .filter((value) => !labelNames.has(value)),
    );

  const filters = compileWhere(ast.where);

  const orderBy =
    ast.orderBy === undefined
      ? "games"
      : ReportOrderBySchema.parse(ast.orderBy.metric.value);
  const orderDirection =
    ast.orderBy?.direction === undefined
      ? "desc"
      : ReportOrderDirectionSchema.parse(ast.orderBy.direction.value);
  const limit =
    ast.limit === undefined
      ? undefined
      : PositiveIntSchema.parse(ast.limit.value);

  const render = parseRenderClause(ast.render?.value, metrics, groupBy);

  return ReportQueryPlanSchema.parse({
    source,
    groupBy,
    groupSize,
    metrics,
    queueFilter: filters.queueFilter,
    championId: filters.championId,
    minGames: filters.minGames,
    competitionId: filters.competitionId,
    orderBy,
    orderDirection,
    limit,
    render,
  });
}

function compileWhere(clauses: ReportWhereClause[]): WhereFilters {
  const filters: WhereFilters = {};
  for (const clause of clauses) {
    match(clause)
      .with({ kind: "unsupported" }, () => {
        throw new Error(UNSUPPORTED_WHERE_MESSAGE);
      })
      .with({ kind: "queue" }, (c) => {
        filters.queueFilter = c.values;
      })
      .with({ kind: "champion_id" }, (c) => {
        filters.championId = PositiveIntSchema.parse(c.value);
      })
      .with({ kind: "min_games" }, (c) => {
        filters.minGames = PositiveIntSchema.parse(c.value);
      })
      .with({ kind: "competition_id" }, (c) => {
        filters.competitionId = PositiveIntSchema.parse(c.value);
      })
      .exhaustive();
  }
  return filters;
}

// ── RENDER clause compilation ────────────────────────────────────────────────
// The trailing `RENDER <kind> [WITH (…)]` clause selects how a report displays.
// Ported from the original string-based parser: the raw clause text (captured by
// the Chevrotain parser) is validated here into a strict ReportRenderSpec.

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

const RENDER_KIND_BY_TOKEN: Record<string, ReportOutputFormat> = {
  bar_chart: "BAR_CHART",
  line_chart: "LINE_CHART",
  table: "TABLE",
  list: "LIST",
  leaderboard: "LEADERBOARD",
};

const CHART_RENDER_KINDS = new Set<ReportOutputFormat>([
  "BAR_CHART",
  "LINE_CHART",
]);

// `with ( … )` wrapper around the comma-separated channel/option pairs.
const RENDER_WITH_PATTERN = /^with\s*\((?<body>.*)\)$/iu;
// A single `key = value` pair; the value is a quoted string or a bareword that
// runs to the next comma/paren. Iterated globally across the WITH body.
const RENDER_PAIR_PATTERN =
  /(?<key>[a-z_]+)\s*=\s*(?<value>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,()]+)/giu;

const RenderPairSchema = z.object({ key: z.string(), value: z.string() });

/**
 * Parse the trailing `RENDER <kind> [WITH (…)]` clause into a fully-validated
 * render spec. `undefined` (no clause) yields the default TABLE spec. Channel
 * references (`x`/`y`) are validated against the columns the query produces —
 * `label` (the GROUP BY dimension) and the SELECTed metrics — so a typo fails
 * fast at parse time instead of silently rendering an empty chart.
 */
export function parseRenderClause(
  clauseText: string | undefined,
  metrics: ReportMetric[],
  groupBy: ReportGroupBy,
): ReportRenderSpec {
  if (clauseText === undefined || clauseText.length === 0) {
    return DEFAULT_RENDER_SPEC;
  }

  const firstSpace = clauseText.indexOf(" ");
  const kindToken =
    firstSpace === -1 ? clauseText : clauseText.slice(0, firstSpace);
  const withText =
    firstSpace === -1 ? "" : clauseText.slice(firstSpace + 1).trim();

  const kind = RENDER_KIND_BY_TOKEN[normalizeToken(kindToken)];
  if (kind === undefined) {
    throw new Error(
      `Unknown RENDER kind "${kindToken}". Expected one of: ${Object.keys(
        RENDER_KIND_BY_TOKEN,
      ).join(", ")}.`,
    );
  }

  if (!CHART_RENDER_KINDS.has(kind)) {
    if (withText.length > 0) {
      throw new Error(
        `RENDER ${normalizeToken(kindToken)} does not take a WITH clause.`,
      );
    }
    return ReportRenderSpecSchema.parse({ kind });
  }

  const { encoding, options } = parseRenderWith(withText, metrics, groupBy);
  return ReportRenderSpecSchema.parse({ kind, encoding, options });
}

function parseRenderWith(
  withText: string,
  metrics: ReportMetric[],
  groupBy: ReportGroupBy,
): { encoding: ReportRenderChannel; options: ReportChartOptions } {
  const encoding: ReportRenderChannel = {};
  const options: ReportChartOptions = {};
  if (withText.length === 0) {
    return { encoding, options };
  }

  const withMatch = RENDER_WITH_PATTERN.exec(withText);
  if (withMatch?.groups === undefined) {
    throw new Error(
      'Invalid RENDER options. Expected: WITH (x = <col>, y = <col>, title = "…", y_axis = "…").',
    );
  }

  const body = withMatch.groups["body"] ?? "";
  for (const renderMatch of body.matchAll(RENDER_PAIR_PATTERN)) {
    const { key, value } = RenderPairSchema.parse(renderMatch.groups);
    const normalizedKey = normalizeToken(key);
    switch (normalizedKey) {
      case "x": {
        encoding.x = assertRenderColumn(
          normalizeColumnRef(value),
          metrics,
          groupBy,
          "x",
        );
        break;
      }
      case "y": {
        encoding.y = assertRenderColumn(
          normalizeColumnRef(value),
          metrics,
          groupBy,
          "y",
        );
        break;
      }
      case "title": {
        options.title = stripRenderQuotes(value);
        break;
      }
      case "y_axis": {
        options.yAxisLabel = stripRenderQuotes(value);
        break;
      }
      default: {
        throw new Error(
          `Unknown RENDER option "${key}". Expected: x, y, title, y_axis.`,
        );
      }
    }
  }

  return { encoding, options };
}

function assertRenderColumn(
  column: string,
  metrics: ReportMetric[],
  groupBy: ReportGroupBy,
  channel: "x" | "y",
): string {
  if (channel === "x") {
    if (groupingColumnNames(groupBy).has(column)) {
      return column;
    }
    throw new Error(
      `RENDER x = "${column}" is not a known dimension. Expected "label" or "${groupBy}".`,
    );
  }
  const metricResult = ReportMetricSchema.safeParse(column);
  if (metricResult.success && metrics.includes(metricResult.data)) {
    return column;
  }
  throw new Error(
    `RENDER y = "${column}" is not a SELECTed metric. Available: ${metrics.join(
      ", ",
    )}.`,
  );
}

function normalizeColumnRef(value: string): string {
  return normalizeToken(stripRenderQuotes(value));
}

function stripRenderQuotes(raw: string): string {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).replaceAll(/\\(["'])/gu, "$1");
  }
  return value;
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
