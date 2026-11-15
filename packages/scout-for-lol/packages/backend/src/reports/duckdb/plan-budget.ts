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
import type { PlanColumnSource } from "#src/reports/duckdb/column-map.ts";
import type { CrawlLakeFiles } from "#src/reports/duckdb/lake/crawl-files.ts";

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

/**
 * A global query whose crawl scan is too large to answer inside the report
 * timeout. Its own class so Explore can tell the model to narrow the window,
 * rather than retrying the same scan until the turn gives up.
 */
export class ScanBudgetExceededError extends Error {
  override readonly name = "ScanBudgetExceededError";
}

/**
 * The most crawl Parquet one global query may read, after ingest-day pruning.
 *
 * About three weeks of the crawl at its top budget step (55k matches a day).
 * The report timeout is the hard stop, but a refusal before any I/O tells the
 * asker what to change and keeps one wide question from holding a report slot
 * for a minute.
 */
export const CRAWL_SCAN_BUDGET_BYTES = 3 * 1024 ** 3;

/** The crawl tables each source scans: its own rows plus its lookups. */
const CRAWL_TABLES_READ: Record<PlanColumnSource, (keyof CrawlLakeFiles)[]> = {
  match: ["matches"],
  "match-team": ["matchTeams", "matches"],
  "match-team-ban": ["matchTeamBans", "matches"],
  "timeline-event": ["timelineEvents", "timelineEventParticipants", "matches"],
  "timeline-frame": [],
  prematch: [],
};

/** Refuse a global plan whose pruned crawl files exceed the scan budget. */
export function enforceCrawlScanBudget(
  crawl: CrawlLakeFiles,
  source: PlanColumnSource,
  budgetBytes: number = CRAWL_SCAN_BUDGET_BYTES,
): void {
  const bytes = CRAWL_TABLES_READ[source]
    .flatMap((table) => crawl[table])
    .reduce((total, file) => total + file.bytes, 0);
  if (bytes > budgetBytes) {
    const gib = (value: number) => (value / 1024 ** 3).toFixed(1);
    throw new ScanBudgetExceededError(
      `This question would scan ${gib(bytes)} GiB of crawled matches, over the ${gib(budgetBytes)} GiB a global query may read. Narrow the time window (for example the last week or patch) and ask again.`,
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
