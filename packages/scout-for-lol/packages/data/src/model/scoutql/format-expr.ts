import { match } from "ts-pattern";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import { scoutQlFunction } from "#src/model/scoutql/catalog-functions.ts";

// ── Canonical expression printer ─────────────────────────────────────────────
// Prints FROM THE AST, not from the source text, so formatting is a real
// normalization rather than a whitespace tidy. Two rules make the output
// re-parse to the same tree:
//
//   * Parentheses are re-derived from the precedence ladder, so only the ones
//     the grammar needs survive. `(a AND b) OR c` keeps its parens; `(a) + b`
//     loses them.
//   * Surface FORM is preserved where the AST records it — `x::INT` vs
//     `CAST(x AS INT)`, `INTERVAL 30 DAY` vs `INTERVAL '30 day'` — because the
//     author's choice is meaning-preserving and rewriting it would surprise.
//
// Casing follows the SQL convention the language reads in: keywords and SQL
// functions uppercase, columns and ScoutQL macros lowercase.

/** The grammar's precedence ladder, low to high. */
const PRECEDENCE = {
  or: 1,
  and: 2,
  not: 3,
  comparison: 4,
  additive: 5,
  multiplicative: 6,
  atTimeZone: 7,
  cast: 8,
  unaryMinus: 9,
  primary: 10,
} as const;

const BINARY_PRECEDENCE: ReadonlyMap<string, number> = new Map([
  ["or", PRECEDENCE.or],
  ["and", PRECEDENCE.and],
  ["=", PRECEDENCE.comparison],
  ["!=", PRECEDENCE.comparison],
  ["<", PRECEDENCE.comparison],
  ["<=", PRECEDENCE.comparison],
  [">", PRECEDENCE.comparison],
  [">=", PRECEDENCE.comparison],
  ["like", PRECEDENCE.comparison],
  ["ilike", PRECEDENCE.comparison],
  ["+", PRECEDENCE.additive],
  ["-", PRECEDENCE.additive],
  ["*", PRECEDENCE.multiplicative],
  ["/", PRECEDENCE.multiplicative],
  ["%", PRECEDENCE.multiplicative],
  ["at-time-zone", PRECEDENCE.atTimeZone],
]);

const BINARY_SYMBOL: ReadonlyMap<string, string> = new Map([
  ["or", "OR"],
  ["and", "AND"],
  ["like", "LIKE"],
  ["ilike", "ILIKE"],
  ["at-time-zone", "AT TIME ZONE"],
]);

function precedenceOf(expr: ScoutQlExprAst): number {
  return match(expr)
    .with({ kind: "binary" }, (node) => {
      const precedence = BINARY_PRECEDENCE.get(node.op);
      if (precedence === undefined) {
        throw new Error(`ScoutQL formatter: unknown operator "${node.op}".`);
      }
      return precedence;
    })
    .with({ kind: "unary" }, (node) =>
      node.op === "not" ? PRECEDENCE.not : PRECEDENCE.unaryMinus,
    )
    .with(
      { kind: "in" },
      { kind: "between" },
      { kind: "is-null" },
      () => PRECEDENCE.comparison,
    )
    .with({ kind: "cast" }, (node) =>
      node.form === "operator" ? PRECEDENCE.cast : PRECEDENCE.primary,
    )
    .otherwise(() => PRECEDENCE.primary);
}

/** Single-quoted, with `''` doubling — the only string form DuckDB accepts. */
export function quoteScoutQlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `ScoutQL formatter: non-finite number ${String(value)}.`,
    );
  }
  return String(value);
}

/** SQL functions shout; ScoutQL's own macros and references stay lowercase. */
function callName(name: string): string {
  const info = scoutQlFunction(name);
  if (info === undefined) {
    return name;
  }
  return info.kind === "aggregate" || info.kind === "scalar"
    ? name.toUpperCase()
    : name;
}

function formatCallArguments(
  expr: Extract<ScoutQlExprAst, { kind: "call" }>,
): string {
  if (expr.star) {
    return "*";
  }
  if (expr.all) {
    return "all";
  }
  const args = expr.args.map((arg) => printExpr(arg, PRECEDENCE.or));
  return `${expr.distinct ? "DISTINCT " : ""}${args.join(", ")}`;
}

function formatCall(expr: Extract<ScoutQlExprAst, { kind: "call" }>): string {
  const call = `${callName(expr.name)}(${formatCallArguments(expr)})`;
  return expr.filter === undefined
    ? call
    : `${call} FILTER (WHERE ${printExpr(expr.filter, PRECEDENCE.or)})`;
}

function formatInterval(
  expr: Extract<ScoutQlExprAst, { kind: "interval" }>,
): string {
  const { amount, unit } = expr;
  if (amount === null || unit === null) {
    // Unreachable from formatScoutQl: an interval this malformed always
    // carries an error diagnostic, and the formatter refuses those queries.
    throw new Error("ScoutQL formatter: interval without an amount or unit.");
  }
  return expr.form === "string"
    ? `INTERVAL ${quoteScoutQlString(`${formatNumber(amount)} ${unit}`)}`
    : `INTERVAL ${formatNumber(amount)} ${unit.toUpperCase()}`;
}

function formatBinary(
  expr: Extract<ScoutQlExprAst, { kind: "binary" }>,
  precedence: number,
): string {
  const symbol = BINARY_SYMBOL.get(expr.op) ?? expr.op;
  const left = printExpr(expr.left, precedence);
  const right = printExpr(expr.right, precedence + 1);
  // `a - -b` would lex as `a` followed by a comment, so a negative right-hand
  // operand of a subtraction takes parentheses it does not strictly need.
  const guarded =
    expr.op === "-" && right.startsWith("-") ? `(${right})` : right;
  return `${left} ${symbol} ${guarded}`;
}

function formatUnary(expr: Extract<ScoutQlExprAst, { kind: "unary" }>): string {
  if (expr.op === "not") {
    return `NOT ${printExpr(expr.operand, PRECEDENCE.comparison)}`;
  }
  const operand = printExpr(expr.operand, PRECEDENCE.unaryMinus);
  return operand.startsWith("-") ? `-(${operand})` : `-${operand}`;
}

function renderExpr(expr: ScoutQlExprAst, precedence: number): string {
  return match(expr)
    .with({ kind: "column" }, (node) => node.name)
    .with({ kind: "number" }, (node) => formatNumber(node.value))
    .with({ kind: "string" }, (node) => quoteScoutQlString(node.value))
    .with({ kind: "boolean" }, (node) => (node.value ? "TRUE" : "FALSE"))
    .with({ kind: "null" }, () => "NULL")
    .with({ kind: "interval" }, (node) => formatInterval(node))
    .with({ kind: "now" }, (node) =>
      node.which === "timestamp" ? "CURRENT_TIMESTAMP" : "CURRENT_DATE",
    )
    .with({ kind: "unary" }, (node) => formatUnary(node))
    .with({ kind: "binary" }, (node) => formatBinary(node, precedence))
    .with({ kind: "cast" }, (node) =>
      node.form === "operator"
        ? `${printExpr(node.operand, PRECEDENCE.cast)}::${node.to.toUpperCase()}`
        : `CAST(${printExpr(node.operand, PRECEDENCE.or)} AS ${node.to.toUpperCase()})`,
    )
    .with({ kind: "in" }, (node) => {
      const items = node.items
        .map((item) => printExpr(item, PRECEDENCE.or))
        .join(", ");
      const operand = printExpr(node.operand, PRECEDENCE.additive);
      return `${operand}${node.negated ? " NOT" : ""} IN (${items})`;
    })
    .with({ kind: "between" }, (node) => {
      const operand = printExpr(node.operand, PRECEDENCE.additive);
      const low = printExpr(node.low, PRECEDENCE.additive);
      const high = printExpr(node.high, PRECEDENCE.additive);
      return `${operand}${node.negated ? " NOT" : ""} BETWEEN ${low} AND ${high}`;
    })
    .with({ kind: "is-null" }, (node) => {
      const operand = printExpr(node.operand, PRECEDENCE.additive);
      return `${operand} IS ${node.negated ? "NOT " : ""}NULL`;
    })
    .with({ kind: "call" }, (node) => formatCall(node))
    .with({ kind: "error" }, () => {
      // Unreachable: formatScoutQl refuses any query with an error-severity
      // diagnostic, and every error node carries one.
      throw new Error("ScoutQL formatter: cannot print an error node.");
    })
    .exhaustive();
}

/**
 * Print an expression, parenthesizing it when its precedence is looser than
 * the context requires.
 */
export function printExpr(expr: ScoutQlExprAst, minPrecedence: number): string {
  const precedence = precedenceOf(expr);
  const text = renderExpr(expr, precedence);
  return precedence < minPrecedence ? `(${text})` : text;
}

/** Print an expression in a context that imposes no precedence constraint. */
export function printScoutQlExpr(expr: ScoutQlExprAst): string {
  return printExpr(expr, PRECEDENCE.or);
}

export const FORMAT_PRECEDENCE = PRECEDENCE;
