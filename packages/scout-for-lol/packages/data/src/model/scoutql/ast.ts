import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";

// ── ScoutQL v2 AST ───────────────────────────────────────────────────────────
// Plain TypeScript types (no Zod) for the fault-tolerant parse result. Every
// node carries a half-open `span` into the original query text. The tree is
// deliberately syntactic: identifiers are lowercased and string escapes
// decoded, but nothing is resolved — name/type/aggregation analysis happens in
// the analyze passes, which consume this shape.

export type ScoutQlUnaryOp = "-" | "not";

export type ScoutQlBinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "like"
  | "ilike"
  | "at-time-zone";

export type ScoutQlExprAst =
  | { kind: "column"; name: string; span: ScoutQlSpan }
  | { kind: "number"; value: number; span: ScoutQlSpan }
  | { kind: "string"; value: string; span: ScoutQlSpan }
  | { kind: "boolean"; value: boolean; span: ScoutQlSpan }
  | { kind: "null"; span: ScoutQlSpan }
  | {
      kind: "interval";
      /** null when the `INTERVAL '…'` string form did not parse as `n unit`. */
      amount: number | null;
      /** Raw lowercased unit ("day", "days", …); validated by analysis. */
      unit: string | null;
      /** Which surface syntax produced it — the formatter preserves the form. */
      form: "number" | "string";
      span: ScoutQlSpan;
    }
  | { kind: "now"; which: "timestamp" | "date"; span: ScoutQlSpan }
  | {
      kind: "unary";
      op: ScoutQlUnaryOp;
      operand: ScoutQlExprAst;
      span: ScoutQlSpan;
    }
  | {
      kind: "binary";
      op: ScoutQlBinaryOp;
      left: ScoutQlExprAst;
      right: ScoutQlExprAst;
      span: ScoutQlSpan;
    }
  | {
      kind: "cast";
      operand: ScoutQlExprAst;
      /** Lowercased type name; validated by analysis. */
      to: string;
      /** `x::t` vs `CAST(x AS t)` — the formatter preserves the form. */
      form: "operator" | "function";
      span: ScoutQlSpan;
    }
  | {
      kind: "in";
      operand: ScoutQlExprAst;
      negated: boolean;
      items: ScoutQlExprAst[];
      span: ScoutQlSpan;
    }
  | {
      kind: "between";
      operand: ScoutQlExprAst;
      negated: boolean;
      low: ScoutQlExprAst;
      high: ScoutQlExprAst;
      span: ScoutQlSpan;
    }
  | {
      kind: "is-null";
      operand: ScoutQlExprAst;
      negated: boolean;
      span: ScoutQlSpan;
    }
  | {
      kind: "call";
      name: string;
      /** `COUNT(*)` — only COUNT may use it; enforced by analysis. */
      star: boolean;
      distinct: boolean;
      /** `group(all)` — only group() may use it; enforced by analysis. */
      all: boolean;
      args: ScoutQlExprAst[];
      filter?: ScoutQlExprAst | undefined;
      span: ScoutQlSpan;
    }
  | { kind: "error"; span: ScoutQlSpan };

// ── Statement shape ──────────────────────────────────────────────────────────

export type ScoutQlSelectItemAst = {
  expr: ScoutQlExprAst;
  alias: string | null;
  aliasSpan: ScoutQlSpan | null;
  span: ScoutQlSpan;
};

export type ScoutQlSelectClauseAst = {
  items: ScoutQlSelectItemAst[];
  span: ScoutQlSpan;
};

export type ScoutQlFromClauseAst = { source: string; span: ScoutQlSpan };

export type ScoutQlWhereClauseAst = {
  expr: ScoutQlExprAst;
  span: ScoutQlSpan;
};

export type ScoutQlGroupByClauseAst = {
  all: boolean;
  items: ScoutQlExprAst[];
  span: ScoutQlSpan;
};

export type ScoutQlHavingClauseAst = {
  expr: ScoutQlExprAst;
  span: ScoutQlSpan;
};

export type ScoutQlOrderKeyAst = {
  expr: ScoutQlExprAst;
  direction: "asc" | "desc" | null;
  span: ScoutQlSpan;
};

export type ScoutQlOrderByClauseAst = {
  keys: ScoutQlOrderKeyAst[];
  span: ScoutQlSpan;
};

export type ScoutQlLimitClauseAst = { value: number; span: ScoutQlSpan };

export type ScoutQlRenderPairValueAst =
  | { kind: "identifier"; name: string; span: ScoutQlSpan }
  | { kind: "string"; value: string; span: ScoutQlSpan };

export type ScoutQlRenderListItemAst =
  | { kind: "identifier"; name: string; span: ScoutQlSpan }
  | { kind: "hex-color"; value: string; span: ScoutQlSpan }
  | { kind: "string"; value: string; span: ScoutQlSpan }
  | { kind: "number"; value: number; span: ScoutQlSpan }
  | {
      kind: "pair";
      name: string;
      value: ScoutQlRenderPairValueAst;
      span: ScoutQlSpan;
    };

export type ScoutQlRenderValueAst =
  | { kind: "number"; value: number; span: ScoutQlSpan }
  | { kind: "string"; value: string; span: ScoutQlSpan }
  | { kind: "hex-color"; value: string; span: ScoutQlSpan }
  | { kind: "boolean"; value: boolean; span: ScoutQlSpan }
  | { kind: "identifier"; name: string; span: ScoutQlSpan }
  | { kind: "list"; items: ScoutQlRenderListItemAst[]; span: ScoutQlSpan };

export type ScoutQlRenderOptionAst = {
  name: string;
  nameSpan: ScoutQlSpan;
  value: ScoutQlRenderValueAst;
  span: ScoutQlSpan;
};

export type ScoutQlRenderClauseAst = {
  kind: string;
  options: ScoutQlRenderOptionAst[];
  span: ScoutQlSpan;
};

/** Partial-tolerant query AST: any clause a broken parse could not produce is absent. */
export type ScoutQlQueryAst = {
  select?: ScoutQlSelectClauseAst | undefined;
  from?: ScoutQlFromClauseAst | undefined;
  where?: ScoutQlWhereClauseAst | undefined;
  groupBy?: ScoutQlGroupByClauseAst | undefined;
  having?: ScoutQlHavingClauseAst | undefined;
  orderBy?: ScoutQlOrderByClauseAst | undefined;
  limit?: ScoutQlLimitClauseAst | undefined;
  render?: ScoutQlRenderClauseAst | undefined;
  span: ScoutQlSpan;
};

// ── Span helpers ─────────────────────────────────────────────────────────────

export function unionSpan(a: ScoutQlSpan, b: ScoutQlSpan): ScoutQlSpan {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/** Zero-length span at a character offset (for "expected here" diagnostics). */
export function collapsedSpan(offset: number): ScoutQlSpan {
  return { start: offset, end: offset };
}

// ── Structural helpers for later passes ──────────────────────────────────────

/**
 * Flatten a nested AND tree into its conjunct list (a non-AND expression is a
 * single conjunct). Used by time-window recognition over top-level WHERE.
 */
export function flattenAnd(expr: ScoutQlExprAst): ScoutQlExprAst[] {
  if (expr.kind === "binary" && expr.op === "and") {
    return [...flattenAnd(expr.left), ...flattenAnd(expr.right)];
  }
  return [expr];
}

function exprKeyList(exprs: ScoutQlExprAst[]): string | null {
  const keys: string[] = [];
  for (const expr of exprs) {
    const key = exprKey(expr);
    if (key === null) {
      return null;
    }
    keys.push(key);
  }
  return keys.join(",");
}

function compositeExprKey(
  expr: Extract<
    ScoutQlExprAst,
    {
      kind: "unary" | "binary" | "cast" | "in" | "between" | "is-null" | "call";
    }
  >,
): string | null {
  switch (expr.kind) {
    case "unary": {
      const operand = exprKey(expr.operand);
      return operand === null ? null : `unary(${expr.op},${operand})`;
    }
    case "binary": {
      const key = exprKeyList([expr.left, expr.right]);
      return key === null ? null : `binary(${expr.op},${key})`;
    }
    case "cast": {
      // `x::t` and `CAST(x AS t)` normalize to the same key on purpose.
      const operand = exprKey(expr.operand);
      return operand === null ? null : `cast(${expr.to},${operand})`;
    }
    case "in": {
      const key = exprKeyList([expr.operand, ...expr.items]);
      return key === null ? null : `in(${String(expr.negated)},${key})`;
    }
    case "between": {
      const key = exprKeyList([expr.operand, expr.low, expr.high]);
      return key === null ? null : `between(${String(expr.negated)},${key})`;
    }
    case "is-null": {
      const operand = exprKey(expr.operand);
      return operand === null
        ? null
        : `is-null(${String(expr.negated)},${operand})`;
    }
    case "call": {
      const args = exprKeyList(expr.args);
      if (args === null) {
        return null;
      }
      let filterKey = "-";
      if (expr.filter !== undefined) {
        const key = exprKey(expr.filter);
        if (key === null) {
          return null;
        }
        filterKey = key;
      }
      const flags = `${String(expr.star)},${String(expr.distinct)},${String(expr.all)}`;
      return `call(${expr.name},${flags},[${args}],${filterKey})`;
    }
  }
}

function exprKey(expr: ScoutQlExprAst): string | null {
  switch (expr.kind) {
    case "column":
      return `col(${expr.name})`;
    case "number":
      return `num(${String(expr.value)})`;
    case "string":
      return `str(${JSON.stringify(expr.value)})`;
    case "boolean":
      return `bool(${String(expr.value)})`;
    case "null":
      return "null";
    case "interval":
      // `INTERVAL 30 DAY` and `INTERVAL '30 day'` normalize to the same key.
      return `interval(${String(expr.amount)},${String(expr.unit)})`;
    case "now":
      return `now(${expr.which})`;
    case "error":
      // Error nodes never compare equal — a broken subtree matches nothing.
      return null;
    case "unary":
    case "binary":
    case "cast":
    case "in":
    case "between":
    case "is-null":
    case "call":
      return compositeExprKey(expr);
  }
}

/**
 * Structural equality of two expressions, ignoring spans and surface form
 * (cast/interval syntax variants). Used for GROUP BY matching. Any expression
 * containing an error node compares equal to nothing, including itself.
 */
export function sameExpr(a: ScoutQlExprAst, b: ScoutQlExprAst): boolean {
  const keyA = exprKey(a);
  if (keyA === null) {
    return false;
  }
  return keyA === exprKey(b);
}
