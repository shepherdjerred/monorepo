import type { SuggestionCondition } from "@scout-for-lol/data";
import {
  diffReplayCase,
  type ReplayBaseline,
  type ReplayDiff,
  type ReplaySide,
} from "#src/explore/replay/diff.ts";
import {
  chipExpectation,
  type ExploreCapabilitySet,
} from "#src/explore/replay/profiles.ts";
import {
  replaySignals,
  type ReplaySignal,
} from "#src/explore/replay/signals.ts";

/**
 * How a case is scored — once, for both the run and anything reading it back.
 *
 * A bundle is raw evidence: what was asked, what came back, which tools ran.
 * The scoring is a judgement laid over that evidence, and judgements change —
 * two of them changed the day the first full sweep was read. If the runner
 * scored one way and the summariser another, a grader fix would silently mean
 * two different things depending on which you looked at.
 *
 * So both call this. Re-scoring an old bundle offline produces exactly what a
 * fresh run would produce today, which is what lets a grader fix apply
 * retroactively to every bundle ever written without spending a penny.
 */

export type ScorableCase = {
  readonly status: "ok" | "error" | "timeout";
  readonly answer: string | null;
  /** Tool name and terminal status per call, in order. */
  readonly trace: readonly {
    readonly toolName: string;
    readonly status: string;
  }[];
  readonly rowsReturned: number | null;
  readonly capabilities: ExploreCapabilitySet;
  /** Null for a conversation turn, which carries no chip condition. */
  readonly condition: SuggestionCondition | null;
  readonly capabilityMismatches: readonly string[];
  /** The candidate's own shape, for comparison against a baseline. */
  readonly candidate: ReplaySide;
  /**
   * What this case is measured against, as a baseline to diff or a diff
   * already taken.
   *
   * A run holds the baseline and computes the comparison. Anything re-scoring
   * a stored case holds the comparison the run recorded and cannot rebuild it
   * — the baseline lived in another bundle. Both must reach the same signals,
   * so both arrive here, and passing neither means the case genuinely had no
   * baseline rather than that the reader could not find one.
   */
  readonly comparison:
    | { readonly kind: "baseline"; readonly baseline: ReplayBaseline }
    | { readonly kind: "diff"; readonly diff: ReplayDiff }
    | { readonly kind: "none" };
  /** Canonical form of a query, so formatting is not mistaken for meaning. */
  readonly normalizeQuery: (text: string) => string | null;
};

export type CaseScore = {
  readonly signals: readonly ReplaySignal[];
  /** Null when this case has no baseline — a first run, or a newly added case. */
  readonly diff: ReplayDiff | null;
};

/**
 * Did a query fail with none afterwards succeeding?
 *
 * A failed query followed by a successful retry is ordinary: in the first full
 * beta sweep twelve of thirteen failures recovered in the same turn and went
 * on to answer well. Only the turn that never got a query to run is worth
 * flagging.
 *
 * "Afterwards" is the whole rule, and it has to mean *after the last failure*.
 * Asking whether any query anywhere succeeded lets an early success excuse a
 * later failure — a turn that queried fine, then broke on its final attempt,
 * and answered on partial data. That is the shape worth reading, so it must
 * not be the shape that is silently suppressed.
 */
export function queryFailedUnrecovered(
  trace: readonly { readonly toolName: string; readonly status: string }[],
): boolean {
  const queries = trace.filter(
    (entry) => entry.toolName === "run_report_query",
  );
  const lastFailure = queries.findLastIndex(
    (entry) => entry.status === "failed",
  );
  return (
    lastFailure !== -1 &&
    !queries
      .slice(lastFailure + 1)
      .some((entry) => entry.status === "succeeded")
  );
}

/**
 * How many rows the baseline returned.
 *
 * Straight off the baseline when there is one. When re-scoring a stored case
 * there is not, so it comes back out of the recorded delta — the run wrote
 * `candidate - baseline`, so the baseline is `candidate - delta`. Both routes
 * have to agree, because `rows_zero_was_nonzero` is decided on this number and
 * a re-score that could not recover it would quietly drop the signal.
 */
function baselineRowsReturned(
  input: ScorableCase,
  diff: ReplayDiff | null,
): number | null {
  if (input.comparison.kind === "baseline") {
    return input.comparison.baseline.rowsReturned;
  }
  const delta = diff?.rows.returnedDelta ?? null;
  return delta === null || input.rowsReturned === null
    ? null
    : input.rowsReturned - delta;
}

export function scoreCase(input: ScorableCase): CaseScore {
  const diff =
    input.comparison.kind === "none"
      ? null
      : input.comparison.kind === "diff"
        ? input.comparison.diff
        : diffReplayCase({
            baseline: input.comparison.baseline,
            candidate: input.candidate,
            normalizeQuery: input.normalizeQuery,
          });

  return {
    diff,
    signals: replaySignals({
      status: input.status,
      answer: input.answer,
      queryFailedUnrecovered: queryFailedUnrecovered(input.trace),
      diff,
      chipExpectation:
        input.condition === null
          ? null
          : chipExpectation(input.capabilities, input.condition),
      capabilityMismatches: input.capabilityMismatches,
      baselineRowsReturned: baselineRowsReturned(input, diff),
      candidateRowsReturned: input.rowsReturned,
    }),
  };
}
