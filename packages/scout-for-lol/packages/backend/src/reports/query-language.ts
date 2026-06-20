import { z } from "zod";
import {
  type ReportGroupBy,
  type ReportQueryPlan,
  ReportGroupBySchema,
  ReportMetricSchema,
  ReportOrderDirectionSchema,
  ReportQueryPlanSchema,
  ReportSourceSchema,
} from "@scout-for-lol/data";

const QueryGroupsSchema = z.object({
  select: z.string(),
  source: z.string(),
  where: z.string().optional(),
  groupBy: z.string(),
  orderBy: z.string().optional(),
  direction: z.string().optional(),
  limit: z.string().optional(),
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

  const whereIndex = lower.indexOf(" where ", fromIndex);
  const orderByIndex = lower.indexOf(" order by ", groupByIndex);
  const limitIndex = lower.indexOf(" limit ", groupByIndex);
  const sourceEnd =
    whereIndex !== -1 && whereIndex < groupByIndex ? whereIndex : groupByIndex;
  const groupByEnd = firstPositiveIndex([
    orderByIndex,
    limitIndex,
    lower.length,
  ]);
  const orderByEnd =
    orderByIndex === -1 ? -1 : firstPositiveIndex([limitIndex, lower.length]);

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
        : normalized.slice(limitIndex + " limit ".length).trim(),
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
