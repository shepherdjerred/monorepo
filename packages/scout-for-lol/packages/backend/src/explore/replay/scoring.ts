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
  readonly baseline: ReplayBaseline | null;
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
 */
export function queryFailedUnrecovered(
  trace: readonly { readonly toolName: string; readonly status: string }[],
): boolean {
  const queries = trace.filter(
    (entry) => entry.toolName === "run_report_query",
  );
  return (
    queries.some((entry) => entry.status === "failed") &&
    !queries.some((entry) => entry.status === "succeeded")
  );
}

export function scoreCase(input: ScorableCase): CaseScore {
  const diff =
    input.baseline === null
      ? null
      : diffReplayCase({
          baseline: input.baseline,
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
      baselineRowsReturned: input.baseline?.rowsReturned ?? null,
      candidateRowsReturned: input.rowsReturned,
    }),
  };
}
