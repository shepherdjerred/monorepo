import type {
  ScoutQlExprAst,
  ScoutQlWhereClauseAst,
} from "#src/model/scoutql/ast.ts";
import { flattenAnd } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlPredicate } from "#src/model/scoutql/expression.ts";
import type { ScoutQlTimeWindow } from "#src/model/scoutql/plan.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import type { SourceCatalog } from "#src/model/scoutql/catalog-columns.ts";
import { closestScoutQlName } from "#src/model/scoutql/catalog-functions.ts";
import {
  emitDiagnostic,
  forEachExprNode,
  playerRefShape,
  type ExprTypingContext,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import { typeConditionExpr } from "#src/model/scoutql/analyze-expr.ts";
import {
  lowerPredicate,
  type PlayerRefCollector,
} from "#src/model/scoutql/analyze-lower.ts";
import {
  recognizeCalendarWindow,
  recognizeRelativeWindow,
  referencesColumn,
  unboundedWarning,
} from "#src/model/scoutql/analyze-window.ts";

// ── WHERE analysis ───────────────────────────────────────────────────────────
// The top-level AND conjuncts are the unit of analysis, because three things
// are lifted OUT of the executed predicate and into the plan: the recognized
// time window, `competition_id = n`, and (structurally, as an index) each
// `player('…')` reference. Everything else stays as the residual predicate the
// engine pushes into the lake scan.

export type WhereAnalysis = {
  /** The residual predicate — recognized time/competition conjuncts removed. */
  where: ScoutQlPredicate | undefined;
  timeWindow: ScoutQlTimeWindow;
  competitionId?: number | undefined;
  /**
   * True when a WHERE conjunct still touches the time column after hoisting
   * — only the first recognized bound can ever be hoisted into `timeWindow`,
   * so a second (e.g. a redundant lower bound, or an explicit two-sided
   * range written as two comparisons instead of BETWEEN) stays behind in
   * `where` unchanged. That residual is reused verbatim for a comparison
   * baseline's substituted (chronologically earlier) range, where it can
   * never be satisfied — `checkCompare` refuses `compare = previous_period`
   * whenever this is true, rather than silently reporting an empty baseline.
   */
  residualTouchesTime: boolean;
};

export type WhereAnalysisInput = {
  clause: ScoutQlWhereClauseAst | undefined;
  catalog: SourceCatalog | undefined;
  typing: ExprTypingContext;
  refs: PlayerRefCollector;
  diagnostics: ScoutQlDiagnostic[];
  /** Where the unbounded warning points, and where its quick fix inserts. */
  anchor: { span: ScoutQlSpan; insertAt: number };
};

const QUEUE_VALUES: ReadonlySet<string> = new Set(QueueTypeSchema.options);

// ── Queue values ─────────────────────────────────────────────────────────────

function checkQueueLiteral(
  operand: ScoutQlExprAst,
  item: ScoutQlExprAst,
  diagnostics: ScoutQlDiagnostic[],
): void {
  if (operand.kind !== "column" || operand.name !== "queue") {
    return;
  }
  if (item.kind !== "string" || QUEUE_VALUES.has(item.value)) {
    return;
  }
  const suggestion = closestScoutQlName(item.value, QUEUE_VALUES);
  emitDiagnostic(diagnostics, {
    code: "unknown-queue",
    severity: "warning",
    message: `"${item.value}" is not a queue Scout records, so this matches no rows.${suggestion === undefined ? ` Known queues: ${[...QUEUE_VALUES].join(", ")}.` : ` Did you mean "${suggestion}"?`}`,
    span: item.span,
  });
}

function checkQueueValues(
  conjunct: ScoutQlExprAst,
  diagnostics: ScoutQlDiagnostic[],
): void {
  forEachExprNode(conjunct, (node) => {
    if (node.kind === "in") {
      for (const item of node.items) {
        checkQueueLiteral(node.operand, item, diagnostics);
      }
      return;
    }
    if (node.kind === "binary" && (node.op === "=" || node.op === "!=")) {
      checkQueueLiteral(node.left, node.right, diagnostics);
      checkQueueLiteral(node.right, node.left, diagnostics);
    }
  });
}

// ── competition_id ───────────────────────────────────────────────────────────

function competitionIdOf(conjunct: ScoutQlExprAst): number | undefined {
  if (conjunct.kind !== "binary" || conjunct.op !== "=") {
    return undefined;
  }
  const sides = [
    { column: conjunct.left, value: conjunct.right },
    { column: conjunct.right, value: conjunct.left },
  ];
  for (const side of sides) {
    if (
      side.column.kind === "column" &&
      side.column.name === "competition_id" &&
      side.value.kind === "number" &&
      Number.isInteger(side.value.value) &&
      side.value.value > 0
    ) {
      return side.value.value;
    }
  }
  return undefined;
}

function checkCompetitionId(
  competitionId: number | undefined,
  input: WhereAnalysisInput,
): void {
  const catalog = input.catalog;
  if (catalog === undefined) {
    return;
  }
  if (competitionId === undefined && catalog.requiresCompetitionId) {
    emitDiagnostic(input.diagnostics, {
      code: "competition-id-required",
      message: `${catalog.id} reports on one competition, so it needs a top-level condition naming it, e.g. WHERE competition_id = 12.`,
      span: input.anchor.span,
    });
  }
  if (competitionId !== undefined && !catalog.requiresCompetitionId) {
    emitDiagnostic(input.diagnostics, {
      code: "competition-id-unavailable",
      message: `competition_id is only meaningful on the competition sources, not ${catalog.id}.`,
      span: input.anchor.span,
    });
  }
}

// ── player('…') conflicts ────────────────────────────────────────────────────

/**
 * Two different players ANDed at the top level match no rows: one row belongs
 * to exactly one player. Under OR they are a legitimate "either of these".
 */
function checkPlayerRefConflict(
  conjuncts: ScoutQlExprAst[],
  diagnostics: ScoutQlDiagnostic[],
): void {
  const seen = new Map<string, ScoutQlExprAst>();
  for (const conjunct of conjuncts) {
    const shape = playerRefShape(conjunct);
    if (shape === undefined) {
      continue;
    }
    const key = shape.name.trim().toLocaleLowerCase("en-US");
    const previous = seen.get(key);
    if (previous === undefined && seen.size > 0) {
      emitDiagnostic(diagnostics, {
        code: "player-ref-conflict",
        message: `A row belongs to one player, so requiring "${shape.name}" as well as "${[...seen.keys()][0] ?? ""}" matches nothing. Use OR to ask about either.`,
        span: shape.span,
      });
    }
    if (previous === undefined) {
      seen.set(key, conjunct);
    }
  }
}

// ── Window classification ────────────────────────────────────────────────────

type ConjunctClass =
  | { kind: "hoisted"; window: ScoutQlTimeWindow }
  | { kind: "residual"; touchesTime: boolean };

function classifyConjunct(
  conjunct: ScoutQlExprAst,
  timeColumn: string,
  alreadyHoisted: boolean,
  diagnostics: ScoutQlDiagnostic[],
): ConjunctClass {
  const touchesTime = referencesColumn(conjunct, timeColumn);
  if (!touchesTime) {
    return { kind: "residual", touchesTime: false };
  }
  const calendar = recognizeCalendarWindow(conjunct, timeColumn, diagnostics);
  if (calendar !== undefined) {
    return !alreadyHoisted && calendar.kind === "window"
      ? { kind: "hoisted", window: calendar.window }
      : { kind: "residual", touchesTime: true };
  }
  const relative = recognizeRelativeWindow(conjunct, timeColumn);
  if (relative !== undefined && !alreadyHoisted) {
    return { kind: "hoisted", window: relative };
  }
  return { kind: "residual", touchesTime: true };
}

// ── Entry point ──────────────────────────────────────────────────────────────

function combineConjuncts(
  conjuncts: ScoutQlExprAst[],
  refs: PlayerRefCollector,
): ScoutQlPredicate | undefined {
  const lowered: ScoutQlPredicate[] = [];
  for (const conjunct of conjuncts) {
    const predicate = lowerPredicate(conjunct, refs);
    if (predicate !== undefined) {
      lowered.push(predicate);
    }
  }
  const [first] = lowered;
  if (first === undefined) {
    return undefined;
  }
  return lowered.length === 1 ? first : { kind: "and", operands: lowered };
}

export function analyzeWhere(input: WhereAnalysisInput): WhereAnalysis {
  const snapshot = input.catalog?.timeColumn === null;
  const timeColumn = input.catalog?.timeColumn ?? null;
  const conjuncts =
    input.clause === undefined ? [] : flattenAnd(input.clause.expr);

  for (const conjunct of conjuncts) {
    typeConditionExpr(conjunct, input.typing);
    checkQueueValues(conjunct, input.diagnostics);
  }
  checkPlayerRefConflict(conjuncts, input.diagnostics);

  let competitionId: number | undefined;
  let window: ScoutQlTimeWindow | undefined;
  let touchesTime = false;
  const residual: ScoutQlExprAst[] = [];

  for (const conjunct of conjuncts) {
    const candidateCompetitionId = competitionIdOf(conjunct);
    if (candidateCompetitionId !== undefined) {
      competitionId ??= candidateCompetitionId;
      continue;
    }
    if (timeColumn === null) {
      residual.push(conjunct);
      continue;
    }
    const classified = classifyConjunct(
      conjunct,
      timeColumn,
      window !== undefined,
      input.diagnostics,
    );
    if (classified.kind === "hoisted") {
      window = classified.window;
      continue;
    }
    touchesTime ||= classified.touchesTime;
    residual.push(conjunct);
  }

  checkCompetitionId(competitionId, input);

  const timeWindow = resolveWindow({
    snapshot,
    timeColumn,
    window,
    touchesTime,
    input,
  });
  return {
    where: combineConjuncts(residual, input.refs),
    timeWindow,
    residualTouchesTime: touchesTime,
    ...(competitionId === undefined ? {} : { competitionId }),
  };
}

function resolveWindow(context: {
  snapshot: boolean;
  timeColumn: string | null;
  window: ScoutQlTimeWindow | undefined;
  touchesTime: boolean;
  input: WhereAnalysisInput;
}): ScoutQlTimeWindow {
  if (context.snapshot || context.timeColumn === null) {
    // Rank sources hold one row per player as of now; there is no history to
    // bound, which is why they expose no time column at all.
    return { kind: "snapshot" };
  }
  if (context.window !== undefined) {
    return context.window;
  }
  if (context.touchesTime) {
    return { kind: "bounded" };
  }
  context.input.diagnostics.push(
    unboundedWarning(context.timeColumn, context.input.anchor.span, {
      at: context.input.anchor.insertAt,
      hasWhere: context.input.clause !== undefined,
    }),
  );
  return { kind: "unbounded" };
}
