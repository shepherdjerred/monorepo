import { QueueTypeSchema, queueHasPostMatchData } from "@scout-for-lol/data";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";

/**
 * Why a query came back empty, when the plan itself already explains it.
 *
 * "No rows matched" is an honest sentence and a useless one: it reads the same
 * whether nobody tracked has played the mode yet or whether Riot never
 * publishes results for it at all. A reader cannot tell those apart, and
 * neither can the model — so it answers "Scout recorded 0 of those", the user
 * tries a narrower window, and the loop repeats. Where the plan pins the
 * cause, say the cause.
 *
 * Deliberately narrow: only filters that CONSTRAIN the query to pre-match-only
 * queues count. A negated or inequality comparison excludes rather than
 * selects, so it cannot be the reason nothing came back.
 */

function isQueueColumn(expr: ScoutQlScalarExpr): boolean {
  return expr.kind === "column" && expr.column === "queue";
}

function literalString(expr: ScoutQlScalarExpr): string | null {
  return expr.kind === "literal" && typeof expr.value === "string"
    ? expr.value
    : null;
}

/** Queue values the WHERE clause restricts `queue` to, in plan order. */
export function queueLiteralsInPredicate(
  predicate: ScoutQlPredicate | undefined,
): readonly string[] {
  if (predicate === undefined) return [];
  switch (predicate.kind) {
    case "and":
    case "or":
      return predicate.operands.flatMap((operand) =>
        queueLiteralsInPredicate(operand),
      );
    case "compare": {
      if (predicate.op !== "=") return [];
      const value = isQueueColumn(predicate.left)
        ? literalString(predicate.right)
        : isQueueColumn(predicate.right)
          ? literalString(predicate.left)
          : null;
      return value === null ? [] : [value];
    }
    case "in":
      return predicate.negated || !isQueueColumn(predicate.operand)
        ? []
        : predicate.items.flatMap((item) =>
            typeof item === "string" ? [item] : [],
          );
    // `not` inverts the meaning, and the rest cannot pin a queue.
    case "not":
    case "between":
    case "is-null":
    case "player-ref":
      return [];
  }
}

/**
 * An extra sentence for the zero-row tool message, or null when the plan says
 * nothing about why. Returned as model-facing instruction text, matching the
 * other `message` strings the Explore tools hand back.
 */
export function emptyResultReason(plan: ScoutQlPlan): string | null {
  const queues = queueLiteralsInPredicate(plan.where);
  if (queues.length === 0) return null;
  const parsed = queues
    .map((queue) => QueueTypeSchema.safeParse(queue))
    .flatMap((result) => (result.success ? [result.data] : []));
  // Every queue the query allows must be pre-match-only for this to be the
  // reason: a query spanning `aram mayhem` and `aram` could still have been
  // empty for ordinary reasons.
  if (parsed.length !== queues.length || parsed.length === 0) return null;
  if (parsed.some((queue) => queueHasPostMatchData(queue))) return null;
  const names = parsed.map((queue) => `'${queue}'`).join(" and ");
  return `This query can never return rows: Riot publishes no finished-match data for ${names}, so Scout only ever sees ${parsed.length === 1 ? "that mode" : "those modes"} pre-match. Tell the user that plainly — it is not a gap in Scout's history that a different date range or player would fill — and do not retry it narrower.`;
}
