import { z } from "zod";
import {
  ReportGroupBySchema,
  ReportMetricSchema,
  ReportOrderBySchema,
  ReportOrderDirectionSchema,
  ReportQueryPlanSchema,
  ReportSourceSchema,
  type ReportQueryAst,
  type ReportQueryPlan,
  type ReportWhereClause,
} from "#src/model/report-query-spec.ts";
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

// Compiles a parsed AST into the strict ReportQueryPlan the executor runs.
// Throws (zod or Error) on any invalid value — same contract as the original
// parseReportQuery.
export function compileReportQuery(ast: ReportQueryAst): ReportQueryPlan {
  if (ast.source === undefined || ast.groupBy === undefined) {
    throw new Error(INVALID_QUERY_MESSAGE);
  }

  const source = ReportSourceSchema.parse(ast.source.value);
  const groupBy = ReportGroupBySchema.parse(ast.groupBy.value);
  const metrics = z
    .array(ReportMetricSchema)
    .min(1)
    .parse(
      ast.select
        .map((item) => item.value)
        .filter((value) => value !== groupBy && value !== "label"),
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

function compileWhere(clauses: ReportWhereClause[]): WhereFilters {
  const filters: WhereFilters = {};
  for (const clause of clauses) {
    switch (clause.kind) {
      case "unsupported": {
        throw new Error(UNSUPPORTED_WHERE_MESSAGE);
      }
      case "queue": {
        filters.queueFilter = clause.values;
        break;
      }
      case "champion_id": {
        filters.championId = PositiveIntSchema.parse(clause.value);
        break;
      }
      case "min_games": {
        filters.minGames = PositiveIntSchema.parse(clause.value);
        break;
      }
      case "competition_id": {
        filters.competitionId = PositiveIntSchema.parse(clause.value);
        break;
      }
    }
  }
  return filters;
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
