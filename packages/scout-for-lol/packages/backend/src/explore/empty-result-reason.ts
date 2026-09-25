import { QueueTypeSchema, queueHasPostMatchData } from "@scout-for-lol/data";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import type {
  ScoutQlPlan,
  ScoutQlSource,
} from "@scout-for-lol/data/model/scoutql/parse/plan.ts";

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
 * The bar for saying so is high, because the claim is absolute: this query can
 * never return a row, at any date, for any player. Two things must hold.
 *
 * The source must be finished matches. `prematch_participants` holds the
 * observations of games STARTING, and those exist in quantity for exactly the
 * queues this module calls unscorable — prod holds 4,686 pre-match ARAM Mayhem
 * rows. An empty pre-match query is explained by its player or date filters,
 * not by the queue.
 *
 * And the WHERE clause must genuinely confine every row to those queues. That
 * is a narrower test than "an unscorable queue is mentioned somewhere":
 * `queue = 'classic' OR kills > 50` mentions one and still admits rows from
 * every other queue.
 */

/** Sources whose rows are finished matches, where a result can be missing. */
const FINISHED_MATCH_SOURCES: ReadonlySet<ScoutQlSource> =
  new Set<ScoutQlSource>([
    "match_participants",
    "match_pairs",
    "match_items",
    "competition_match_participants",
  ]);

/**
 * The queues a predicate confines `queue` to, or null when it confines
 * nothing. Null is "any queue is still possible", which is why `or` collapses
 * to it as soon as one branch stops constraining.
 */
type QueueConstraint = ReadonlySet<string> | null;

function isQueueColumn(expr: ScoutQlScalarExpr): boolean {
  return expr.kind === "column" && expr.column === "queue";
}

function literalString(expr: ScoutQlScalarExpr): string | null {
  return expr.kind === "literal" && typeof expr.value === "string"
    ? expr.value
    : null;
}

function intersect(
  left: QueueConstraint,
  right: QueueConstraint,
): QueueConstraint {
  if (left === null) return right;
  return right === null
    ? left
    : new Set([...left].filter((queue) => right.has(queue)));
}

function union(left: QueueConstraint, right: QueueConstraint): QueueConstraint {
  // One unconstrained branch is enough to admit any queue.
  return left === null || right === null ? null : new Set([...left, ...right]);
}

export function queueConstraintOf(
  predicate: ScoutQlPredicate | undefined,
): QueueConstraint {
  if (predicate === undefined) return null;
  switch (predicate.kind) {
    case "and":
      // Every operand holds, so each one may narrow the set further.
      return predicate.operands
        .map((operand) => queueConstraintOf(operand))
        .reduce((left, right) => intersect(left, right), null);
    case "or":
      // Any operand may hold, so the set widens — and an unconstrained branch
      // widens it to everything.
      return predicate.operands
        .map((operand) => queueConstraintOf(operand))
        .reduce((left, right) => union(left, right));
    case "compare": {
      if (predicate.op !== "=") return null;
      const value = isQueueColumn(predicate.left)
        ? literalString(predicate.right)
        : isQueueColumn(predicate.right)
          ? literalString(predicate.left)
          : null;
      return value === null ? null : new Set([value]);
    }
    case "in":
      return predicate.negated || !isQueueColumn(predicate.operand)
        ? null
        : new Set(
            predicate.items.flatMap((item) =>
              typeof item === "string" ? [item] : [],
            ),
          );
    // `not` inverts the meaning, and the rest cannot pin a queue.
    case "not":
    case "between":
    case "is-null":
    case "player-ref":
      return null;
  }
}

/**
 * An extra sentence for the zero-row tool message, or null when the plan says
 * nothing about why. Returned as model-facing instruction text, matching the
 * other `message` strings the Explore tools hand back.
 */
export function emptyResultReason(plan: ScoutQlPlan): string | null {
  if (!FINISHED_MATCH_SOURCES.has(plan.source)) return null;
  const constraint = queueConstraintOf(plan.where);
  if (constraint === null || constraint.size === 0) return null;
  const queues = [...constraint]
    .map((queue) => QueueTypeSchema.safeParse(queue))
    .flatMap((result) => (result.success ? [result.data] : []));
  // An unrecognised literal could name anything, so it breaks the proof.
  if (queues.length !== constraint.size) return null;
  if (queues.some((queue) => queueHasPostMatchData(queue))) return null;
  const names = queues.map((queue) => `'${queue}'`).join(" and ");
  return `This query can never return rows: Riot publishes no finished-match data for ${names}, so Scout only ever sees ${queues.length === 1 ? "that mode" : "those modes"} pre-match. Tell the user that plainly — it is not a gap in Scout's history that a different date range or player would fill — and do not retry it narrower.`;
}
