import { match } from "ts-pattern";
import { parseReportQuery } from "#src/model/report-query-parser.ts";
import type {
  ReportQueryAst,
  ReportQueryItem,
  ReportWhereClause,
} from "#src/model/report-query-spec.ts";

export function formatReportQuery(queryText: string): string {
  const trimmed = queryText.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const { ast, diagnostics } = parseReportQuery(trimmed);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return trimmed;
  }

  return formatAst(ast) ?? trimmed;
}

function formatAst(ast: ReportQueryAst): string | null {
  if (ast.source === undefined || ast.groupBy === undefined) {
    return null;
  }

  const clauses = [
    `SELECT ${formatSelect(ast.select)}`,
    `FROM ${ast.source.value}`,
    formatWhere(ast.where),
    `GROUP BY ${ast.groupBy.value}`,
    formatOrderBy(ast.orderBy),
    formatLimit(ast.limit),
    formatRender(ast.render),
  ];

  return clauses.filter((clause) => clause !== null).join("\n");
}

function formatSelect(items: ReportQueryItem[]): string {
  return items.map((item) => item.value).join(", ");
}

function formatWhere(clauses: ReportWhereClause[]): string | null {
  if (clauses.length === 0) {
    return null;
  }
  const [first, ...rest] = clauses.map((clause) => formatWhereClause(clause));
  if (first === undefined) {
    return null;
  }
  return [`WHERE ${first}`, ...rest.map((clause) => `  AND ${clause}`)].join(
    "\n",
  );
}

function formatWhereClause(clause: ReportWhereClause): string {
  return match(clause)
    .with({ kind: "queue" }, (value) => `queue IN (${value.values.join(", ")})`)
    .with(
      { kind: "champion_id" },
      (value) => `champion_id = ${value.value.toString()}`,
    )
    .with(
      { kind: "min_games" },
      (value) => `games >= ${value.value.toString()}`,
    )
    .with(
      { kind: "competition_id" },
      (value) => `competition_id = ${value.value.toString()}`,
    )
    .with({ kind: "unsupported" }, (value) => value.text)
    .exhaustive();
}

function formatOrderBy(orderBy: ReportQueryAst["orderBy"]): string | null {
  if (orderBy === undefined) {
    return null;
  }
  const direction =
    orderBy.direction === undefined ? "" : ` ${orderBy.direction.value}`;
  return `ORDER BY ${orderBy.metric.value}${direction}`;
}

function formatLimit(limit: ReportQueryItem | undefined): string | null {
  return limit === undefined ? null : `LIMIT ${limit.value}`;
}

function formatRender(render: ReportQueryItem | undefined): string | null {
  return render === undefined ? null : `RENDER ${render.value}`;
}
