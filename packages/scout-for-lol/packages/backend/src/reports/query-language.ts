import { z } from "zod";
import {
  DEFAULT_RENDER_SPEC,
  ReportRenderSpecSchema,
  type ReportChartOptions,
  type ReportOutputFormat,
  type ReportRenderChannel,
  type ReportRenderSpec,
} from "@scout-for-lol/data";

export type ReportSource = z.infer<typeof ReportSourceSchema>;
export const ReportSourceSchema = z.enum([
  "match_participants",
  "prematch_participants",
  "player_pairs",
  "rank_current",
  "competition_match_participants",
  "competition_rank",
]);

export type ReportGroupBy = z.infer<typeof ReportGroupBySchema>;
export const ReportGroupBySchema = z.enum([
  "player",
  "champion",
  "queue",
  "pair",
]);

export type ReportMetric = z.infer<typeof ReportMetricSchema>;
export const ReportMetricSchema = z.enum([
  "games",
  "wins",
  "losses",
  "surrenders",
  "surrender_rate",
  "win_rate",
  "kills",
  "deaths",
  "assists",
  "kda",
  "creep_score",
  "damage_to_champions",
  "prematches",
  "score",
]);

export type ReportOrderDirection = z.infer<typeof ReportOrderDirectionSchema>;
export const ReportOrderDirectionSchema = z.enum(["asc", "desc"]);

export type ReportQueryPlan = z.infer<typeof ReportQueryPlanSchema>;
export const ReportQueryPlanSchema = z.object({
  source: ReportSourceSchema,
  groupBy: ReportGroupBySchema,
  metrics: z.array(ReportMetricSchema).min(1),
  queueFilter: z.array(z.string().min(1)).optional(),
  championId: z.number().int().positive().optional(),
  minGames: z.number().int().positive().optional(),
  competitionId: z.number().int().positive().optional(),
  orderBy: z.union([ReportMetricSchema, z.literal("label")]).default("games"),
  orderDirection: ReportOrderDirectionSchema.default("desc"),
  limit: z.number().int().positive().optional(),
  // Declarative display spec parsed from the query's trailing RENDER clause.
  // Always present: queries without a clause default to a TABLE render.
  render: ReportRenderSpecSchema.default(DEFAULT_RENDER_SPEC),
});

const QueryGroupsSchema = z.object({
  select: z.string(),
  source: z.string(),
  where: z.string().optional(),
  groupBy: z.string(),
  orderBy: z.string().optional(),
  direction: z.string().optional(),
  limit: z.string().optional(),
  // Raw text after the `RENDER ` keyword (e.g. `bar_chart with (y = win_rate)`).
  render: z.string().optional(),
});

const QueueFilterGroupsSchema = z.object({
  values: z.string(),
});
const ChampionFilterGroupsSchema = z.object({
  value: z.string(),
});
const MinGamesFilterGroupsSchema = z.object({
  value: z.string(),
});
const CompetitionFilterGroupsSchema = z.object({
  value: z.string(),
});

const QUEUE_FILTER_PATTERN = /^queue\s+in\s*\((?<values>[^)]+)\)$/i;
const CHAMPION_FILTER_PATTERN = /^champion_id\s*=\s*(?<value>\d+)$/i;
const MIN_GAMES_FILTER_PATTERN = /^games\s*>=\s*(?<value>\d+)$/i;
const COMPETITION_FILTER_PATTERN = /^competition_id\s*=\s*(?<value>\d+)$/i;

export function parseReportQuery(queryText: string): ReportQueryPlan {
  const groups = parseQueryGroups(queryText);
  const source = ReportSourceSchema.parse(normalizeToken(groups.source));
  const groupBy = ReportGroupBySchema.parse(normalizeToken(groups.groupBy));
  const metrics = parseSelectMetrics(groups.select, groupBy);
  const filters = parseWhere(groups.where);
  const orderBy =
    groups.orderBy === undefined
      ? "games"
      : z
          .union([ReportMetricSchema, z.literal("label")])
          .parse(normalizeToken(groups.orderBy));
  const orderDirection =
    groups.direction === undefined
      ? "desc"
      : ReportOrderDirectionSchema.parse(normalizeToken(groups.direction));
  const limit =
    groups.limit === undefined
      ? undefined
      : z.coerce.number().int().positive().parse(groups.limit);
  const render = parseRenderClause(groups.render, metrics, groupBy);

  return ReportQueryPlanSchema.parse({
    source,
    groupBy,
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

function parseQueryGroups(queryText: string) {
  const normalized = queryText.trim().split(/\s+/u).join(" ");
  const lower = normalized.toLowerCase();
  const selectPrefix = "select ";
  if (!lower.startsWith(selectPrefix)) {
    throwInvalidQuery();
  }

  const fromIndex = lower.indexOf(" from ");
  const groupByIndex = lower.indexOf(" group by ");
  if (fromIndex === -1 || groupByIndex === -1 || groupByIndex <= fromIndex) {
    throwInvalidQuery();
  }

  // The display clause is the tail: `… RENDER <kind> [WITH (…)]`. Split it off
  // first so the SELECT/…/LIMIT slicing below never trips over keywords that
  // appear inside a quoted option value (e.g. `title = "no limit"`).
  const renderIndex = lower.indexOf(" render ", groupByIndex);
  const queryEnd = renderIndex === -1 ? lower.length : renderIndex;
  const inQuery = (index: number): number =>
    index !== -1 && index < queryEnd ? index : -1;

  const whereIndex = inQuery(lower.indexOf(" where ", fromIndex));
  const orderByIndex = inQuery(lower.indexOf(" order by ", groupByIndex));
  const limitIndex = inQuery(lower.indexOf(" limit ", groupByIndex));
  const sourceEnd =
    whereIndex !== -1 && whereIndex < groupByIndex ? whereIndex : groupByIndex;
  const groupByEnd = firstPositiveIndex([orderByIndex, limitIndex, queryEnd]);
  const orderByEnd =
    orderByIndex === -1 ? -1 : firstPositiveIndex([limitIndex, queryEnd]);

  const orderParts =
    orderByIndex === -1
      ? []
      : normalized
          .slice(orderByIndex + " order by ".length, orderByEnd)
          .trim()
          .split(" ");

  return QueryGroupsSchema.parse({
    select: normalized.slice(selectPrefix.length, fromIndex),
    source: normalized.slice(fromIndex + " from ".length, sourceEnd),
    where:
      whereIndex !== -1 && whereIndex < groupByIndex
        ? normalized.slice(whereIndex + " where ".length, groupByIndex)
        : undefined,
    groupBy: normalized.slice(groupByIndex + " group by ".length, groupByEnd),
    orderBy: orderParts[0],
    direction: orderParts[1],
    limit:
      limitIndex === -1
        ? undefined
        : normalized.slice(limitIndex + " limit ".length, queryEnd).trim(),
    render:
      renderIndex === -1
        ? undefined
        : normalized.slice(renderIndex + " render ".length).trim(),
  });
}

function firstPositiveIndex(indexes: number[]): number {
  return Math.min(...indexes.filter((index) => index !== -1));
}

function throwInvalidQuery(): never {
  throw new Error(
    "Invalid report query. Expected: SELECT <metrics> FROM <source> [WHERE queue IN (...)] GROUP BY <field> [ORDER BY <metric> DESC] [LIMIT n]",
  );
}

function parseSelectMetrics(selectText: string, groupBy: ReportGroupBy) {
  const tokens = selectText.split(",").map((token) => normalizeToken(token));
  const metrics = tokens.filter(
    (token) => token !== groupBy && token !== "label",
  );
  return z.array(ReportMetricSchema).min(1).parse(metrics);
}

type ReportWhereFilters = {
  queueFilter?: string[];
  championId?: number;
  minGames?: number;
  competitionId?: number;
};

function parseWhere(whereText: string | undefined): ReportWhereFilters {
  if (whereText === undefined) {
    return {};
  }

  const filters: ReportWhereFilters = {};
  const clauses = whereText
    .split(/\s+and\s+/iu)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

  for (const clause of clauses) {
    const queueMatch = QUEUE_FILTER_PATTERN.exec(clause);
    if (queueMatch !== null) {
      const groups = QueueFilterGroupsSchema.parse(queueMatch.groups);
      filters.queueFilter = groups.values
        .split(",")
        .map((value) => normalizeQueueValue(value))
        .filter((value) => value.length > 0);
      continue;
    }

    const championMatch = CHAMPION_FILTER_PATTERN.exec(clause);
    if (championMatch !== null) {
      const groups = ChampionFilterGroupsSchema.parse(championMatch.groups);
      filters.championId = z.coerce
        .number()
        .int()
        .positive()
        .parse(groups.value);
      continue;
    }

    const minGamesMatch = MIN_GAMES_FILTER_PATTERN.exec(clause);
    if (minGamesMatch !== null) {
      const groups = MinGamesFilterGroupsSchema.parse(minGamesMatch.groups);
      filters.minGames = z.coerce.number().int().positive().parse(groups.value);
      continue;
    }

    const competitionMatch = COMPETITION_FILTER_PATTERN.exec(clause);
    if (competitionMatch !== null) {
      const groups = CompetitionFilterGroupsSchema.parse(
        competitionMatch.groups,
      );
      filters.competitionId = z.coerce
        .number()
        .int()
        .positive()
        .parse(groups.value);
      continue;
    }

    throw new Error("Unsupported report WHERE clause.");
  }

  return filters;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeQueueValue(value: string): string {
  const normalized = normalizeToken(value);
  const first = normalized.at(0);
  const last = normalized.at(-1);
  if (
    normalized.length >= 2 &&
    ((first === "'" && last === "'") || (first === '"' && last === '"'))
  ) {
    return normalized.slice(1, -1);
  }
  return normalized;
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
  for (const match of body.matchAll(RENDER_PAIR_PATTERN)) {
    const { key, value } = RenderPairSchema.parse(match.groups);
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
    if (column === "label" || column === groupBy) {
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
