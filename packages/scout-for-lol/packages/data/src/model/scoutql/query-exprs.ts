import type {
  ScoutQlExprAst,
  ScoutQlQueryAst,
} from "#src/model/scoutql/ast.ts";

/**
 * Every expression ROOT in a query, in clause order: SELECT items, the WHERE
 * predicate, GROUP BY terms, the HAVING predicate, and ORDER BY keys.
 *
 * The services need this often enough — the formatter checks all of them for
 * error nodes, hover locates a call among them, semantic tokens upgrade the
 * identifiers in them — that having each keep its own copy of the clause list
 * would mean a new clause is silently missed by whichever copy was forgotten.
 */
export function scoutQlQueryExprs(ast: ScoutQlQueryAst): ScoutQlExprAst[] {
  return [
    ...(ast.select?.items ?? []).map((item) => item.expr),
    ...(ast.where === undefined ? [] : [ast.where.expr]),
    ...(ast.groupBy?.items ?? []),
    ...(ast.having === undefined ? [] : [ast.having.expr]),
    ...(ast.orderBy?.keys ?? []).map((key) => key.expr),
  ];
}
