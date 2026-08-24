import type { ScoutQlDiagnostic } from "#src/model/scoutql/diagnostics.ts";
import { analyzeScoutQl } from "#src/model/scoutql/analyze.ts";

// ── lintScoutQl ──────────────────────────────────────────────────────────────
// The editor-facing lint entry point. It is deliberately thin: the ONE
// fault-tolerant analysis pass already produces every coded, spanned
// diagnostic (parse, name resolution, typing, aggregation context, window,
// render), sorted by position and carrying its own quick fixes. A second
// "lint-only" rule set would be a place for the editor and the compiler to
// disagree, which is exactly the drift v2 removes.

/**
 * Every diagnostic for a query, in source order. Never throws — a query that
 * cannot be parsed at all still yields positioned `parse-error` diagnostics.
 *
 * Severity is the contract the editor renders: `error` diagnostics are the
 * ones `compileScoutQl` refuses on, `warning`/`info` are advisory (e.g.
 * `time-window-unbounded`).
 */
export function lintScoutQl(text: string): ScoutQlDiagnostic[] {
  return analyzeScoutQl(text).diagnostics;
}

/** Whether the query compiles — i.e. holds no error-severity diagnostic. */
export function scoutQlIsValid(text: string): boolean {
  return !lintScoutQl(text).some(
    (diagnostic) => diagnostic.severity === "error",
  );
}
