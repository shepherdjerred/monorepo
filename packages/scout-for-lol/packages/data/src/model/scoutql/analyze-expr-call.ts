import { match } from "ts-pattern";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlFix,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import {
  closestChampionName,
  resolveReportChampion,
} from "#src/model/reports/report-query-champions.ts";
import {
  closestScoutQlFunctionName,
  scoutQlFunction,
} from "#src/model/scoutql/catalog-functions.ts";
import {
  comparable,
  containsErrorNode,
  emitDiagnostic,
  exprContainsAggregate,
  isNumeric,
  type ExprTyper,
  type ExprTypingContext,
  type ScoutQlExprType,
} from "#src/model/scoutql/analyze-expr-shared.ts";

// ── Call typing ──────────────────────────────────────────────────────────────
// Arity, DISTINCT/*/FILTER acceptance, and result types for every registry
// function, plus the two macro forms and the two reference forms. Aggregation
// placement rules (no aggregates in WHERE/FILTER/GROUP BY, no nesting) are
// enforced here because the call site is where the violation is visible.

type CallNode = Extract<ScoutQlExprAst, { kind: "call" }>;

const BOOLEAN_REJECTING_AGGREGATES: ReadonlySet<string> = new Set([
  "sum",
  "avg",
  "median",
  "quantile_cont",
  "stddev",
]);

function checkCallFlags(
  node: CallNode,
  info: {
    acceptsStar: boolean;
    acceptsDistinct: boolean;
    acceptsFilter: boolean;
  },
  ctx: ExprTypingContext,
): void {
  if (node.star && !info.acceptsStar) {
    emitDiagnostic(ctx.diagnostics, {
      code: "function-arity",
      message: `Only COUNT(*) takes *; ${node.name.toUpperCase()} needs an expression.`,
      span: node.span,
    });
  }
  if (node.distinct && !info.acceptsDistinct) {
    emitDiagnostic(ctx.diagnostics, {
      code: "distinct-unsupported",
      message: "DISTINCT is only supported on COUNT — COUNT(DISTINCT x).",
      span: node.span,
    });
  } else if (
    node.distinct &&
    (ctx.catalog?.id === "player_groups" ||
      ctx.catalog?.id === "rank_current" ||
      ctx.catalog?.id === "competition_rank")
  ) {
    // player_groups folds its unit (a k-subset of one game's tracked
    // players) in JS before aggregation ever runs, and the rank sources fold
    // leaderboard entries in JS the same way (rank-report.ts) — so by the
    // time COUNT reaches a row the distinct values behind it are already
    // gone, and aggregate-eval.ts's evaluator has no choice but to throw.
    // Reject here, at compile time, so `validate_report_query` cannot
    // approve a report that is guaranteed to fail at preview or schedule
    // time.
    emitDiagnostic(ctx.diagnostics, {
      code: "distinct-unsupported",
      message:
        "COUNT(DISTINCT …) is not supported here: this source's rows are already a JS-side fold (a teammate group, or a leaderboard entry), so the distinct values behind it are gone by the time COUNT would run.",
      span: node.span,
    });
  }
  if (node.all) {
    emitDiagnostic(ctx.diagnostics, {
      code: "function-arity",
      message: "Only group(all) takes the all keyword.",
      span: node.span,
    });
  }
  if (node.filter !== undefined && !info.acceptsFilter) {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: "FILTER (WHERE …) only applies to aggregate functions.",
      span: node.span,
    });
  }
}

function checkArity(
  node: CallNode,
  bounds: { minArgs: number; maxArgs: number },
  ctx: ExprTypingContext,
): boolean {
  if (node.star) {
    return true;
  }
  if (node.args.length < bounds.minArgs || node.args.length > bounds.maxArgs) {
    const expected =
      bounds.minArgs === bounds.maxArgs
        ? String(bounds.minArgs)
        : `${String(bounds.minArgs)}–${String(bounds.maxArgs)}`;
    emitDiagnostic(ctx.diagnostics, {
      code: "function-arity",
      message: `${node.name.toUpperCase()} takes ${expected} argument(s); got ${String(node.args.length)}.`,
      span: node.span,
    });
    return false;
  }
  return true;
}

function typeAggregateArgs(
  node: CallNode,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType[] {
  const argCtx: ExprTypingContext = { ...ctx, inAggregate: true };
  const types = node.args.map((arg) => typer.typeOfExpr(arg, argCtx));
  if (node.filter !== undefined) {
    typer.typeConditionExpr(node.filter, {
      ...ctx,
      clause: "filter",
      inAggregate: false,
      allowPlayerRef: false,
    });
  }
  return types;
}

function booleanAggregateFix(arg: ScoutQlExprAst): ScoutQlFix[] {
  return [
    {
      title: "Cast to INT",
      edits: [{ start: arg.span.end, end: arg.span.end, newText: "::INT" }],
    },
  ];
}

function typeQuantileFraction(node: CallNode, ctx: ExprTypingContext): void {
  const fraction = node.args[1];
  if (fraction === undefined) {
    return;
  }
  if (
    fraction.kind !== "number" ||
    fraction.value <= 0 ||
    fraction.value >= 1
  ) {
    emitDiagnostic(ctx.diagnostics, {
      code: "quantile-out-of-range",
      message:
        "QUANTILE_CONT's fraction must be a number literal strictly between 0 and 1.",
      span: fraction.span,
    });
  }
}

/** Aggregates are illegal in WHERE/FILTER/GROUP BY and cannot nest. */
function checkAggregatePlacement(node: CallNode, ctx: ExprTypingContext): void {
  if (ctx.clause === "where" || ctx.clause === "filter") {
    emitDiagnostic(ctx.diagnostics, {
      code: "aggregate-in-where",
      message:
        ctx.clause === "where"
          ? "Aggregates are not allowed in WHERE — it filters raw rows. Use HAVING for aggregate conditions."
          : "FILTER conditions see raw rows and cannot contain aggregates.",
      span: node.span,
    });
    return;
  }
  if (ctx.clause === "group") {
    emitDiagnostic(ctx.diagnostics, {
      code: "grouping-expression-invalid",
      message: "GROUP BY expressions cannot contain aggregates.",
      span: node.span,
    });
    return;
  }
  if (ctx.inAggregate === true) {
    emitDiagnostic(ctx.diagnostics, {
      code: "nested-aggregate",
      message: "Aggregates cannot be nested inside another aggregate.",
      span: node.span,
    });
  }
}

function typeAggregateCall(
  node: CallNode,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  checkAggregatePlacement(node, ctx);
  const argTypes = typeAggregateArgs(node, ctx, typer);
  const argType = argTypes[0] ?? "unknown";
  const arg = node.args[0];
  if (
    argType === "boolean" &&
    arg !== undefined &&
    BOOLEAN_REJECTING_AGGREGATES.has(node.name)
  ) {
    emitDiagnostic(ctx.diagnostics, {
      code: "aggregate-over-boolean",
      message: `${node.name.toUpperCase()} over a boolean is a type error in DuckDB — write ${node.name.toUpperCase()}(${arg.kind === "column" ? arg.name : "x"}::INT).`,
      span: node.span,
      fixes: booleanAggregateFix(arg),
    });
    return "double";
  }
  const requireNumeric = (label: string): boolean => {
    if (arg !== undefined && argType !== "unknown" && !isNumeric(argType)) {
      emitDiagnostic(ctx.diagnostics, {
        code: "type-mismatch",
        message: `${label} needs a numeric argument; got ${argType}.`,
        span: arg.span,
      });
      return false;
    }
    return true;
  };
  return match(node.name)
    .with("count", (): ScoutQlExprType => "integer")
    .with("sum", (): ScoutQlExprType => {
      if (!requireNumeric("SUM")) {
        return "unknown";
      }
      return argType === "integer" ? "integer" : "double";
    })
    .with("avg", "stddev", "quantile_cont", (name): ScoutQlExprType => {
      if (name === "quantile_cont") {
        typeQuantileFraction(node, ctx);
      }
      requireNumeric(name.toUpperCase());
      return "double";
    })
    .with("median", (): ScoutQlExprType => {
      if (argType === "timestamp") {
        return "timestamp";
      }
      requireNumeric("MEDIAN");
      return "double";
    })
    .with("min", "max", (): ScoutQlExprType => argType)
    .otherwise((): ScoutQlExprType => "unknown");
}

function typeMacroCall(
  node: CallNode,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  if (
    ctx.clause === "where" ||
    ctx.clause === "filter" ||
    ctx.clause === "group"
  ) {
    return typeAggregateCall(node, ctx, typer);
  }
  if (ctx.inAggregate === true) {
    emitDiagnostic(ctx.diagnostics, {
      code: "nested-aggregate",
      message: `${node.name}() is an aggregate macro and cannot be nested inside another aggregate.`,
      span: node.span,
    });
  }
  const macroColumns =
    node.name === "kda" ? ["kills", "deaths", "assists"] : ["time_played"];
  for (const column of macroColumns) {
    if (ctx.catalog !== undefined && !ctx.catalog.columns.has(column)) {
      emitDiagnostic(ctx.diagnostics, {
        code: "unknown-column",
        message: `${node.name}() needs the ${column} column, which ${ctx.catalog.id} does not have.`,
        span: node.span,
      });
    }
  }
  const argTypes = typeAggregateArgs(node, ctx, typer);
  const argType = argTypes[0];
  if (
    argType !== undefined &&
    argType !== "unknown" &&
    node.name === "per_minute" &&
    !isNumeric(argType)
  ) {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: `per_minute needs a numeric argument; got ${argType}.`,
      span: node.args[0]?.span ?? node.span,
    });
  }
  return "double";
}

function commonType(
  types: ScoutQlExprType[],
  span: ScoutQlSpan,
  ctx: ExprTypingContext,
): ScoutQlExprType {
  const known = types.filter((type) => type !== "unknown" && type !== "null");
  const [first] = known;
  if (first === undefined) {
    return "unknown";
  }
  for (const type of known) {
    if (!comparable(first, type)) {
      emitDiagnostic(ctx.diagnostics, {
        code: "type-mismatch",
        message: `Arguments mix incompatible types (${first} and ${type}).`,
        span,
      });
      return "unknown";
    }
  }
  if (known.every((type) => type === "integer")) {
    return "integer";
  }
  if (known.every((type) => isNumeric(type))) {
    return "double";
  }
  return first;
}

const DATE_TRUNC_PARTS: ReadonlySet<string> = new Set(["day", "week", "month"]);

function typeDateTrunc(
  node: CallNode,
  argTypes: ScoutQlExprType[],
  ctx: ExprTypingContext,
): ScoutQlExprType {
  const part = node.args[0];
  // The engine reads the part off a literal node; a computed part has no
  // compiled form, so require the literal here.
  if (
    part !== undefined &&
    (part.kind !== "string" || !DATE_TRUNC_PARTS.has(part.value))
  ) {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message:
        "DATE_TRUNC's part must be the string literal 'day', 'week', or 'month'.",
      span: part.span,
    });
  }
  const operand = node.args[1];
  if (operand === undefined) {
    return "timestamp";
  }
  if (ctx.inAggregate !== true && exprContainsAggregate(operand)) {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message:
        "DATE_TRUNC over an aggregate is not supported — put DATE_TRUNC in GROUP BY instead.",
      span: node.span,
    });
    return "timestamp";
  }
  const operandType = argTypes[1] ?? "unknown";
  if (operandType !== "timestamp" && operandType !== "unknown") {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: `DATE_TRUNC needs a timestamp; got ${operandType}.`,
      span: operand.span,
    });
  }
  return "timestamp";
}

function typeScalarCall(
  node: CallNode,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  const argTypes = node.args.map((arg) => typer.typeOfExpr(arg, ctx));
  const requireNumericArgs = (label: string): void => {
    node.args.forEach((arg, index) => {
      const argType = argTypes[index] ?? "unknown";
      if (argType !== "unknown" && !isNumeric(argType)) {
        emitDiagnostic(ctx.diagnostics, {
          code: "type-mismatch",
          message: `${label} needs numeric arguments; got ${argType}.`,
          span: arg.span,
        });
      }
    });
  };
  return match(node.name)
    .with("round", (): ScoutQlExprType => {
      requireNumericArgs("ROUND");
      const digits = node.args[1];
      // Bound as a literal by the engine — a computed digit count has no
      // compiled form.
      if (
        digits !== undefined &&
        (digits.kind !== "number" || !Number.isInteger(digits.value))
      ) {
        emitDiagnostic(ctx.diagnostics, {
          code: "type-mismatch",
          message: "ROUND's digits must be an integer literal.",
          span: digits.span,
        });
      }
      return "double";
    })
    .with("floor", "ceil", (name): ScoutQlExprType => {
      requireNumericArgs(name.toUpperCase());
      return argTypes[0] === "integer" ? "integer" : "double";
    })
    .with("abs", (): ScoutQlExprType => {
      requireNumericArgs("ABS");
      return argTypes[0] ?? "unknown";
    })
    .with("coalesce", "greatest", "least", (): ScoutQlExprType =>
      commonType(argTypes, node.span, ctx),
    )
    .with("nullif", (): ScoutQlExprType => {
      commonType(argTypes, node.span, ctx);
      return argTypes[0] ?? "unknown";
    })
    .with("date_trunc", (): ScoutQlExprType =>
      typeDateTrunc(node, argTypes, ctx),
    )
    .otherwise((): ScoutQlExprType => "unknown");
}

function typeReferenceCall(
  node: CallNode,
  ctx: ExprTypingContext,
): ScoutQlExprType {
  if (node.name === "player") {
    // Valid player('…') shapes are consumed by typeConditionExpr before typing
    // descends here, so reaching this point is always a misuse.
    emitDiagnostic(ctx.diagnostics, {
      code: "player-ref-unavailable",
      message:
        "player('…') is only usable as a WHERE condition (bare, or player = player('…')).",
      span: node.span,
    });
    return "unknown";
  }
  const arg = node.args[0];
  if (arg?.kind !== "string") {
    if (arg !== undefined && !containsErrorNode(arg)) {
      emitDiagnostic(ctx.diagnostics, {
        code: "function-arity",
        message: "champion('…') takes one string literal.",
        span: node.span,
      });
    }
    return "integer";
  }
  if (resolveReportChampion(arg.value) === undefined) {
    const suggestion = closestChampionName(arg.value);
    emitDiagnostic(ctx.diagnostics, {
      code: "champion-unknown",
      message: `Unknown champion "${arg.value}".${suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`}`,
      span: arg.span,
    });
  }
  return "integer";
}

export function typeCall(
  node: CallNode,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  const info = scoutQlFunction(node.name);
  if (info === undefined) {
    if (node.name === "group") {
      emitDiagnostic(ctx.diagnostics, {
        code: "group-call-unavailable",
        message: "group(…) is only valid in GROUP BY, on player_groups.",
        span: node.span,
      });
      return "unknown";
    }
    const suggestion =
      node.name === "per_game"
        ? undefined
        : closestScoutQlFunctionName(node.name);
    emitDiagnostic(ctx.diagnostics, {
      code: "unknown-function",
      message:
        node.name === "per_game"
          ? "per_game is gone — a per-game average is AVG(x)."
          : `Unknown function "${node.name}".${suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`}`,
      span: node.span,
    });
    return "unknown";
  }
  checkCallFlags(node, info, ctx);
  if (!checkArity(node, info, ctx)) {
    return "unknown";
  }
  return match(info.kind)
    .with("aggregate", () => typeAggregateCall(node, ctx, typer))
    .with("macro", () => typeMacroCall(node, ctx, typer))
    .with("scalar", () => typeScalarCall(node, ctx, typer))
    .with("reference", () => typeReferenceCall(node, ctx))
    .exhaustive();
}
