import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import { compileLegacyAst, parseLegacyQuery } from "./scoutql-legacy-bridge.ts";
import { legacyPlanToV2 } from "./scoutql-v2-legacy-plan.ts";
import { rewriteLegacyQueryText } from "./scoutql-v2-rewrite.ts";
import {
  UnconvertibleQueryError,
  unconvertible,
} from "./scoutql-v2-unconvertible.ts";

// ── The conversion, and the property that makes it trustworthy ───────────────
// Two independent routes from one legacy query to one v2 plan:
//
//   A: legacy text → legacy plan → legacyPlanToV2       (IR translation)
//   B: legacy text → rewritten text → compileScoutQl    (the real analyzer)
//
// They share the legacy plan and nothing else — not a metric table, not a
// clause writer, not a display-kind rule. A rewrite that spliced a predicate
// into the wrong clause, pointed a counter at the wrong lake column, lost a
// LIMIT, or widened a window disagrees with the translation and fails the
// migration by row id. Comparing the rewrite against itself, which is the
// tempting shape here, would prove only that the rewriter is deterministic.

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function planFields(plan: ScoutQlPlan): Record<string, unknown> {
  return { ...plan };
}

/** Every plan field the two routes disagree on, described for a human. */
function describeDifference(
  expected: ScoutQlPlan,
  actual: ScoutQlPlan,
): string {
  const left = planFields(expected);
  const right = planFields(actual);
  const keys = [
    ...new Set([...Object.keys(left), ...Object.keys(right)]),
  ].toSorted();
  return keys
    .filter((key) => !Bun.deepEquals(left[key], right[key], true))
    .map(
      (key) =>
        `${key}:\n        translated: ${JSON.stringify(left[key])}\n        compiled:   ${JSON.stringify(right[key])}`,
    )
    .join("\n      ");
}

/**
 * Whether a stored query is already ScoutQL v2 — not just whether it
 * compiles as v2.
 *
 * A query can be valid under both grammars at once with different meanings:
 * legacy `SELECT kills FROM match_participants GROUP BY all` is a grand-total
 * `SUM(kills)`, while v2 treats the bare `kills` column as a DuckDB
 * `GROUP BY ALL` grouping. Trusting "compiles as v2" alone would let that row
 * skip conversion and silently change what it reports. So: if the text also
 * parses and compiles as legacy, its translated plan must match the v2 plan
 * exactly before this returns true. Only text that legacy cannot make sense
 * of at all — the ordinary case for a row already rewritten by a previous
 * boot — is trusted on the v2 compile alone.
 *
 * This is what makes the migration idempotent: the second boot after a
 * rewrite finds every row compiling with no legacy interpretation (or an
 * agreeing one) and touches nothing.
 */
export function isAlreadyV2(queryText: string): boolean {
  let v2Plan: ScoutQlPlan;
  try {
    v2Plan = compileScoutQl(queryText);
  } catch {
    return false;
  }
  const legacyParsed = parseLegacyQuery(queryText);
  const legacyParseFailed = legacyParsed.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (legacyParseFailed) {
    return true;
  }
  let legacyPlan;
  try {
    legacyPlan = compileLegacyAst(legacyParsed.ast);
  } catch {
    // Parses as legacy but does not compile as legacy — not meaningful
    // legacy ScoutQL, so there is no legacy interpretation to collide with.
    return true;
  }
  try {
    return Bun.deepEquals(legacyPlanToV2(legacyPlan), v2Plan, true);
  } catch {
    // The legacy plan is real but v2 has no faithful equivalent for it (e.g.
    // an implicit ORDER BY on a column the query never selects) — that is
    // exactly a genuine, un-collapsible legacy interpretation, so this text
    // is not already-v2. Let the ordinary conversion route classify it.
    return false;
  }
}

/**
 * Rewrite one stored legacy query into ScoutQL v2, verified by two routes.
 *
 * @throws {UnconvertibleQueryError} when the legacy query does not parse or
 * compile, when it uses a construct v2 deliberately dropped, or when the two
 * routes disagree.
 */
export function convertLegacyQueryText(queryText: string): string {
  const parsed = parseLegacyQuery(queryText);
  const firstError = parsed.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (firstError !== undefined) {
    return unconvertible(`legacy parse failed: ${firstError.message}`);
  }
  let plan;
  try {
    plan = compileLegacyAst(parsed.ast);
  } catch (error) {
    return unconvertible(`legacy compile failed: ${message(error)}`);
  }

  const rewritten = rewriteLegacyQueryText(queryText, parsed.ast, plan);
  const translated = legacyPlanToV2(plan);
  let compiled: ScoutQlPlan;
  try {
    compiled = compileScoutQl(rewritten);
  } catch (error) {
    return unconvertible(
      `the rewritten query does not compile under ScoutQL v2: ${message(error)}\n      rewritten: ${rewritten}`,
    );
  }
  if (!Bun.deepEquals(translated, compiled, true)) {
    return unconvertible(
      `the rewritten query means something else than the original:\n      ${describeDifference(translated, compiled)}\n      rewritten: ${rewritten}`,
    );
  }
  return rewritten;
}

export type ConversionResult =
  | { kind: "already-v2" }
  | { kind: "converted"; queryText: string }
  | { kind: "unconvertible"; reason: string };

/** Classify one stored query without throwing. */
export function convertStoredQuery(queryText: string): ConversionResult {
  if (isAlreadyV2(queryText)) {
    return { kind: "already-v2" };
  }
  try {
    return { kind: "converted", queryText: convertLegacyQueryText(queryText) };
  } catch (error) {
    if (error instanceof UnconvertibleQueryError) {
      return { kind: "unconvertible", reason: error.message };
    }
    throw error;
  }
}
