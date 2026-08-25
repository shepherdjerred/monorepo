import { ScoutQlError } from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlOutput, ScoutQlPlan } from "#src/model/scoutql/plan.ts";
import { parseScoutQlPlan } from "#src/model/scoutql/plan.ts";
import {
  analyzeScoutQl,
  type ScoutQlAnalysis,
} from "#src/model/scoutql/analyze.ts";
import type { AnalyzedOutput } from "#src/model/scoutql/analyze-select.ts";

// ── compileScoutQl — text → executable plan ──────────────────────────────────
// "Strict" is a post-condition, not a second parser: `analyzeScoutQl` runs the
// one fault-tolerant pass, and compilation refuses if it produced any
// error-severity diagnostic. Every legal query therefore compiles, and every
// refusal carries the same coded, spanned diagnostics the editor shows.

function requireOutput(output: AnalyzedOutput): ScoutQlOutput {
  if (output.expr === undefined) {
    // Unreachable: analysis emits an error for every unrepresentable shape,
    // and this runs only when there were none. Fail loudly rather than
    // silently dropping an output the author asked for.
    throw new Error(
      `ScoutQL internal error: output "${output.name}" analyzed cleanly but produced no expression.`,
    );
  }
  return {
    name: output.name,
    expr: output.expr,
    displayKind: output.displayKind,
    additive: output.additive,
    evidence: output.evidence,
  };
}

/**
 * Apply `RENDER … WITH (format = (alias = kind))` overrides. The explicit
 * override wins over the inferred display kind — inference is a default, not a
 * ceiling.
 */
function applyFormatOverrides(
  outputs: ScoutQlOutput[],
  analysis: ScoutQlAnalysis,
): ScoutQlOutput[] {
  const render = analysis.render;
  const overrides =
    "options" in render &&
    render.options !== undefined &&
    "format" in render.options
      ? render.options.format
      : undefined;
  if (overrides === undefined) {
    return outputs;
  }
  return outputs.map((output) => {
    const override = overrides[output.name];
    return override === undefined
      ? output
      : { ...output, displayKind: override };
  });
}

/** Assemble a validated plan from a clean analysis. */
export function planFromAnalysis(analysis: ScoutQlAnalysis): ScoutQlPlan {
  const errors = analysis.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length > 0) {
    throw new ScoutQlError(analysis.diagnostics);
  }
  const outputs = applyFormatOverrides(
    analysis.outputs.map((output) => requireOutput(output)),
    analysis,
  );
  return parseScoutQlPlan({
    source: analysis.source?.id,
    outputs,
    where: analysis.where,
    timeWindow: analysis.timeWindow,
    groupings: analysis.groupings.map((grouping) => grouping.grouping),
    having: analysis.having,
    orderBy: analysis.orderBy,
    limit: analysis.limit,
    playerRefs: analysis.playerRefs,
    competitionId: analysis.competitionId,
    render: analysis.render,
  });
}

/**
 * Compile ScoutQL text into an executable plan.
 *
 * @throws {ScoutQlError} when the query holds any error-severity diagnostic;
 * the error carries every diagnostic, warnings included, so callers can show
 * the whole list rather than only the first problem.
 */
export function compileScoutQl(text: string): ScoutQlPlan {
  return planFromAnalysis(analyzeScoutQl(text));
}
