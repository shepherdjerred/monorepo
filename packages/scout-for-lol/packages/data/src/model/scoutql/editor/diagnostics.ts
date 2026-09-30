import { z } from "zod";

// ── ScoutQL diagnostics ──────────────────────────────────────────────────────
// Every problem the language layer can report, as a coded, spanned diagnostic.
// One shape serves the compiler (which refuses on any error-severity
// diagnostic), the Monaco editor (markers + quick fixes), and the AI validate
// tool (serialized verbatim). Tests pin diagnostic *codes*, never message
// prose, so wording can improve without breaking suites.

/** Half-open character offset range [start, end) into the query text. */
export type ScoutQlSpan = { start: number; end: number };

export type ScoutQlSeverity = z.infer<typeof ScoutQlSeveritySchema>;
export const ScoutQlSeveritySchema = z.enum(["error", "warning", "info"]);

/**
 * Closed registry of diagnostic codes. Every diagnostic the analyzer can emit
 * appears here, and the corpus test asserts every code has at least one
 * negative test case — an undocumented diagnostic cannot exist. Extend this
 * array in the same change that introduces the new check.
 */
export const SCOUTQL_DIAGNOSTIC_CODES = [
  // Lexing / parsing
  "lex-error",
  "parse-error",
  "string-double-quoted",
  "case-unsupported",
  "query-too-long",
  // Name resolution
  "unknown-source",
  "unknown-column",
  "unknown-function",
  "unknown-queue",
  "champion-unknown",
  // Typing
  "type-mismatch",
  "aggregate-over-boolean",
  "cast-type-invalid",
  "interval-unit-invalid",
  "function-arity",
  "quantile-out-of-range",
  "distinct-unsupported",
  // Casting an aggregate RESULT (`SUM(x)::DOUBLE`) is unrepresentable in the
  // plan IR and unnecessary in DuckDB (`/` is float division); the cast goes
  // inside the argument (`AVG(win::INT)`).
  "cast-around-aggregate",
  // Backstop: an expression that types cleanly but has no plan-IR
  // representation. Reaching this means analysis is missing a specific rule —
  // the point is that the author still gets a coded, spanned refusal instead
  // of an internal crash from the compiler.
  "expression-unsupported",
  // Aggregation context
  "aggregate-in-where",
  "nested-aggregate",
  "column-not-grouped",
  // GROUP BY expressions are limited to the engine's deterministic FLOOR
  // bucket shapes (`FLOOR(x / w)`, `FLOOR(x / w) * w`) and must be
  // aggregate-free.
  "grouping-expression-invalid",
  "alias-required",
  "alias-duplicate",
  "alias-invalid",
  "having-target-unknown",
  "order-target-unknown",
  // Source rules
  "time-column-unavailable",
  "player-ref-unavailable",
  "player-ref-conflict",
  "competition-id-required",
  "competition-id-unavailable",
  "group-call-unavailable",
  "source-column-context",
  // Time window
  "time-window-unbounded",
  "time-window-invalid",
  // Limits
  "output-count",
  "grouping-count",
  "order-key-count",
  "in-list-too-long",
  "expression-too-deep",
  "expression-too-large",
  "limit-invalid",
  // Render
  "unknown-render-kind",
  "unknown-render-option",
  "render-option-invalid",
  "render-shape-invalid",
  "render-channel-unknown",
  "render-compare-unavailable",
] as const;

export type ScoutQlDiagnosticCode = (typeof SCOUTQL_DIAGNOSTIC_CODES)[number];
export const ScoutQlDiagnosticCodeSchema = z.enum(SCOUTQL_DIAGNOSTIC_CODES);

/** A single text edit; offsets index the original (pre-edit) query text. */
export type ScoutQlFixEdit = { start: number; end: number; newText: string };

/**
 * A machine-applicable repair carried on the diagnostic itself, so the editor
 * can offer it as a quick fix without re-deriving the analysis. Edits within
 * one fix must not overlap.
 */
export type ScoutQlFix = { title: string; edits: ScoutQlFixEdit[] };

export type ScoutQlDiagnostic = {
  code: ScoutQlDiagnosticCode;
  message: string;
  severity: ScoutQlSeverity;
  span: ScoutQlSpan;
  fixes?: ScoutQlFix[] | undefined;
};

/** Convenience: the first error-severity diagnostic, or undefined. */
export function firstScoutQlError(
  diagnostics: ScoutQlDiagnostic[],
): ScoutQlDiagnostic | undefined {
  return diagnostics.find((diagnostic) => diagnostic.severity === "error");
}

/**
 * Thrown by `compileScoutQl` when the analysis holds error-severity
 * diagnostics. Carries the full list so callers (the AI validate tool, the
 * report router's BAD_REQUEST path) can surface every problem, not just the
 * first.
 */
export class ScoutQlError extends Error {
  readonly diagnostics: ScoutQlDiagnostic[];

  constructor(diagnostics: ScoutQlDiagnostic[]) {
    const first = firstScoutQlError(diagnostics);
    super(first?.message ?? "Invalid ScoutQL query.");
    this.name = "ScoutQlError";
    this.diagnostics = diagnostics;
  }
}
