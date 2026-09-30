import { match } from "ts-pattern";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type {
  ScoutQlAggregateExpr,
  ScoutQlEvidence,
  ScoutQlPredicate,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import {
  collectPredicateColumnNames,
  countPredicateNodes,
  countScalarNodes,
} from "#src/reports/duckdb/expr-sql.ts";
import {
  collectAggregateColumnNames,
  collectHavingColumnNames,
  countAggregateNodes,
  countHavingNodes,
} from "#src/reports/duckdb/aggregate-sql.ts";

/**
 * How large a plan may be, and which columns it names.
 *
 * Both answers are pure functions of the IR, needed before any SQL exists: the
 * caps stop a pathological plan from reaching DuckDB at all, and the column
 * walk decides what the facts CTE has to project. Kept beside the compiler
 * rather than inside it because neither depends on the lake, the scope, or a
 * source.
 */

const PER_EXPRESSION_NODE_CAP = 64;
const PLAN_NODE_CAP = 256;

export function cappedNodes(count: number, what: string): number {
  if (count > PER_EXPRESSION_NODE_CAP) {
    throw new Error(
      `${what} exceeds the ${PER_EXPRESSION_NODE_CAP.toString()}-node expression cap (${count.toString()} nodes).`,
    );
  }
  return count;
}

export function evidenceExpressions(
  evidence: ScoutQlEvidence,
): ScoutQlAggregateExpr[] {
  return match(evidence)
    .with({ kind: "rate" }, (rate) => [rate.successes, rate.trials])
    .with({ kind: "ratio" }, (ratio) => [ratio.numerator, ratio.denominator])
    .with({ kind: "sample" }, () => [])
    .exhaustive();
}

export function enforcePlanNodeBudget(plan: ScoutQlPlan): void {
  let total = 0;
  if (plan.where !== undefined) {
    total += cappedNodes(countPredicateNodes(plan.where), "WHERE");
  }
  if (plan.having !== undefined) {
    total += cappedNodes(countHavingNodes(plan.having), "HAVING");
  }
  for (const output of plan.outputs) {
    total +=
      output.expr.kind === "grouping-ref"
        ? 1
        : cappedNodes(
            countAggregateNodes(output.expr),
            `Output "${output.name}"`,
          );
    total += 1;
    for (const expr of evidenceExpressions(output.evidence)) {
      total += cappedNodes(countAggregateNodes(expr), "Evidence");
    }
  }
  for (const grouping of plan.groupings) {
    total +=
      grouping.kind === "expression"
        ? cappedNodes(countScalarNodes(grouping.expr), "GROUP BY expression")
        : 1;
  }
  if (total > PLAN_NODE_CAP) {
    throw new Error(
      `Plan exceeds the ${PLAN_NODE_CAP.toString()}-node budget (${total.toString()} nodes).`,
    );
  }
}

export function referencedColumnNames(plan: ScoutQlPlan): Set<string> {
  const referenced = new Set<string>();
  if (plan.where !== undefined) {
    collectPredicateColumnNames(plan.where, referenced);
  }
  if (plan.having !== undefined) {
    collectHavingColumnNames(plan.having, referenced);
  }
  for (const output of plan.outputs) {
    if (output.expr.kind !== "grouping-ref") {
      collectAggregateColumnNames(output.expr, referenced);
    }
    for (const expr of evidenceExpressions(output.evidence)) {
      collectAggregateColumnNames(expr, referenced);
    }
  }
  return referenced;
}

export function flattenConjuncts(pred: ScoutQlPredicate): ScoutQlPredicate[] {
  return pred.kind === "and"
    ? pred.operands.flatMap((operand) => flattenConjuncts(operand))
    : [pred];
}
