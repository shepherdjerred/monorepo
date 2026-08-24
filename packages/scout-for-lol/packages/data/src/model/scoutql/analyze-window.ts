import { z } from "zod";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlTimeWindow } from "#src/model/scoutql/plan.ts";
import {
  emitDiagnostic,
  forEachExprNode,
  isValidTimeZone,
  normalizeIntervalUnit,
} from "#src/model/scoutql/analyze-expr-shared.ts";

// ── Structural time-window recognition ───────────────────────────────────────
// Two conjunct shapes are recognized and HOISTED out of the executed predicate
// into `plan.timeWindow`:
//
//   relative:  t >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
//   calendar:  (t AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN 'a' AND 'b'
//              t::DATE BETWEEN 'a' AND 'b'          (UTC)
//
// Hoisting is not an optimization: competition ranges and
// `compare = previous_period` SUBSTITUTE the range, and a predicate left inline
// could only intersect with them (previous period ∩ last 30 days = ∅).
//
// Anything else that merely mentions the time column is `bounded` — a real
// filter the engine still applies, with the execution range falling back to all
// history. Nothing at all is `unbounded`, which is legal and linted.

const IsoDateSchema = z.iso.date();

const RELATIVE_UNITS: ReadonlyMap<string, "day" | "week" | "month" | "year"> =
  new Map([
    ["day", "day"],
    ["week", "week"],
    ["month", "month"],
    ["year", "year"],
  ]);

export function referencesColumn(
  expr: ScoutQlExprAst,
  column: string,
): boolean {
  let found = false;
  forEachExprNode(expr, (node) => {
    if (node.kind === "column" && node.name === column) {
      found = true;
    }
  });
  return found;
}

/** `CURRENT_TIMESTAMP - INTERVAL n unit`, as a relative window. */
function nowMinusInterval(
  expr: ScoutQlExprAst,
): Extract<ScoutQlTimeWindow, { kind: "relative" }> | undefined {
  if (expr.kind !== "binary" || expr.op !== "-") {
    return undefined;
  }
  if (expr.left.kind !== "now" || expr.left.which !== "timestamp") {
    return undefined;
  }
  const interval = expr.right;
  if (interval.kind !== "interval" || interval.amount === null) {
    return undefined;
  }
  const normalized = normalizeIntervalUnit(interval.unit);
  const unit =
    normalized === undefined ? undefined : RELATIVE_UNITS.get(normalized);
  if (
    unit === undefined ||
    !Number.isInteger(interval.amount) ||
    interval.amount <= 0
  ) {
    return undefined;
  }
  return { kind: "relative", amount: interval.amount, unit };
}

function isTimeColumn(expr: ScoutQlExprAst, timeColumn: string): boolean {
  return expr.kind === "column" && expr.name === timeColumn;
}

/**
 * `t >= CURRENT_TIMESTAMP - INTERVAL n unit`, in either operand order. `>` is
 * accepted alongside `>=`: over a continuous timestamp the difference is a
 * single instant, and rejecting it would be pedantry rather than precision.
 */
export function recognizeRelativeWindow(
  conjunct: ScoutQlExprAst,
  timeColumn: string,
): Extract<ScoutQlTimeWindow, { kind: "relative" }> | undefined {
  if (conjunct.kind !== "binary") {
    return undefined;
  }
  const { op, left, right } = conjunct;
  if ((op === ">=" || op === ">") && isTimeColumn(left, timeColumn)) {
    return nowMinusInterval(right);
  }
  if ((op === "<=" || op === "<") && isTimeColumn(right, timeColumn)) {
    return nowMinusInterval(left);
  }
  return undefined;
}

/** The `t::DATE` / `(t AT TIME ZONE 'Z')::DATE` operand of a calendar BETWEEN. */
function calendarOperand(
  operand: ScoutQlExprAst,
  timeColumn: string,
): { timezone: string } | undefined {
  if (operand.kind !== "cast") {
    return undefined;
  }
  const to = operand.to === "date" ? "date" : undefined;
  if (to === undefined) {
    return undefined;
  }
  const inner = operand.operand;
  if (isTimeColumn(inner, timeColumn)) {
    return { timezone: "UTC" };
  }
  if (
    inner.kind === "binary" &&
    inner.op === "at-time-zone" &&
    isTimeColumn(inner.left, timeColumn) &&
    inner.right.kind === "string"
  ) {
    return { timezone: inner.right.value };
  }
  return undefined;
}

export type CalendarRecognition =
  | { kind: "window"; window: Extract<ScoutQlTimeWindow, { kind: "calendar" }> }
  | { kind: "invalid" };

/**
 * `<date operand> BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'`. Returns "invalid"
 * when the operand is a recognized calendar operand but the bounds are not a
 * usable date range — that is a mistake worth a message, not a silent
 * downgrade to a residual predicate.
 */
export function recognizeCalendarWindow(
  conjunct: ScoutQlExprAst,
  timeColumn: string,
  diagnostics: ScoutQlDiagnostic[],
): CalendarRecognition | undefined {
  if (conjunct.kind !== "between" || conjunct.negated) {
    return undefined;
  }
  const operand = calendarOperand(conjunct.operand, timeColumn);
  if (operand === undefined) {
    return undefined;
  }
  const { low, high } = conjunct;
  if (low.kind !== "string" || high.kind !== "string") {
    return undefined;
  }
  const startDate = IsoDateSchema.safeParse(low.value);
  const endDate = IsoDateSchema.safeParse(high.value);
  if (!startDate.success || !endDate.success) {
    emitDiagnostic(diagnostics, {
      code: "time-window-invalid",
      message:
        "A calendar time bound takes ISO dates, e.g. BETWEEN '2026-01-01' AND '2026-01-31'.",
      span: conjunct.span,
    });
    return { kind: "invalid" };
  }
  if (startDate.data > endDate.data) {
    emitDiagnostic(diagnostics, {
      code: "time-window-invalid",
      message: `The time window starts after it ends (${startDate.data} … ${endDate.data}).`,
      span: conjunct.span,
    });
    return { kind: "invalid" };
  }
  if (!isValidTimeZone(operand.timezone)) {
    return { kind: "invalid" };
  }
  return {
    kind: "window",
    window: {
      kind: "calendar",
      startDate: startDate.data,
      endDate: endDate.data,
      timezone: operand.timezone,
    },
  };
}

/** The quick fix offered on an unbounded query: add a 30-day bound. */
export function timeBoundFix(
  timeColumn: string,
  insertion: { at: number; hasWhere: boolean },
): { title: string; edits: { start: number; end: number; newText: string }[] } {
  const predicate = `${timeColumn} >= CURRENT_TIMESTAMP - INTERVAL 30 DAY`;
  return {
    title: "Add a 30-day time bound",
    edits: [
      {
        start: insertion.at,
        end: insertion.at,
        newText: insertion.hasWhere
          ? ` AND ${predicate}`
          : ` WHERE ${predicate}`,
      },
    ],
  };
}

export function unboundedWarning(
  timeColumn: string,
  span: ScoutQlSpan,
  insertion: { at: number; hasWhere: boolean },
): ScoutQlDiagnostic {
  return {
    code: "time-window-unbounded",
    severity: "warning",
    message: `This query states no time bound, so it covers all ingested history. Add one (e.g. ${timeColumn} >= CURRENT_TIMESTAMP - INTERVAL 30 DAY) to answer about a period.`,
    span,
    fixes: [timeBoundFix(timeColumn, insertion)],
  };
}
