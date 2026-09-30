import { looksLikeExploreRefusal } from "#src/explore/capability-eval.ts";
import type { ChipExpectation } from "#src/explore/replay/profiles.ts";
import { numericClaims, type ReplayDiff } from "#src/explore/replay/diff.ts";

/**
 * Which cases to read first.
 *
 * A sweep produces hundreds of rows and almost all of them are fine. These are
 * triage aids, not verdicts: a signal says "worth your attention", never "this
 * is a regression". Answer quality is decided by a person reading the bundle —
 * the reason the harness is A/B and manual before it is ever automated.
 *
 * `capability_mismatch`, `gated_chip_did_not_refuse` and
 * `ungated_chip_refused` are different in kind. They are not judgement calls:
 * they check that the run was the configuration it claims to be and that a
 * chip behaved as its profile requires. Those are the assertions that make a
 * capability matrix mean anything.
 */

export const REPLAY_SIGNALS = [
  /** The turn threw. */
  "new_turn_errored",
  /** The turn ran out of time rather than failing. */
  "new_turn_timed_out",
  /** It finished, but said nothing. */
  "new_answer_empty",
  /** A query failed and the turn never got one to run. */
  "new_query_failed",
  /** The baseline found rows here and this run found none. */
  "rows_zero_was_nonzero",
  /** The baseline answered with substance; this run declined. */
  "refusal_regression",
  /** A figure the baseline asserted is gone from the new answer. */
  "numeric_claim_dropped",
  /** The turn did not resolve the capabilities its profile promised. */
  "capability_mismatch",
  /** The feature is off, and the answer did not say so anywhere. */
  "gated_chip_did_not_refuse",
  /** The feature is on, and the answer declined anyway. */
  "ungated_chip_refused",
] as const;

export type ReplaySignal = (typeof REPLAY_SIGNALS)[number];

export type ReplaySignalInput = {
  readonly status: "ok" | "error" | "timeout";
  readonly answer: string | null;
  /**
   * A query failed and no later one succeeded.
   *
   * Recovery is the common case and is not a defect: in the first full beta
   * sweep twelve of thirteen failed queries were retried successfully in the
   * same turn and answered well. Flagging those buried the one that did not.
   */
  readonly queryFailedUnrecovered: boolean;
  readonly diff: ReplayDiff | null;
  /** Null for a conversation turn, which has no profile expectation. */
  readonly chipExpectation: ChipExpectation | null;
  readonly capabilityMismatches: readonly string[];
  readonly baselineRowsReturned: number | null;
  readonly candidateRowsReturned: number | null;
};

/**
 * Whether this answer actually declined — as opposed to merely containing a
 * negation.
 *
 * `EXPLORE_REFUSAL_PHRASES` is a *permissive* vocabulary. It exists so the
 * capability eval can ask "did the answer decline in any of the wordings we
 * teach?", where a false positive costs nothing. It is full of ordinary
 * negations — "cannot", "does not", "is not" — so "Ezreal does not play mid"
 * matches it. Used directly as "this answer is a refusal" it would fire on a
 * large share of perfectly good answers.
 *
 * So the two directions use different tests, on purpose:
 *
 * - "did NOT refuse" asks whether the vocabulary is absent. Absence is strong
 *   evidence: an answer containing no negation of any kind certainly did not
 *   decline.
 * - "DID refuse" — this function — additionally requires that the answer rests
 *   on nothing: no rows returned, and no figures asserted. A real decline
 *   states no statistics, because there were none to state.
 *
 * Both are built on the one shared vocabulary rather than a second copy of it,
 * which is what keeps the harness and the capability eval from disagreeing
 * about what a refusal even is.
 */
export function declinedToAnswer(input: {
  readonly answer: string;
  readonly rowsReturned: number | null;
}): boolean {
  return (
    looksLikeExploreRefusal(input.answer) &&
    (input.rowsReturned ?? 0) === 0 &&
    numericClaims(input.answer).size === 0 &&
    input.answer.length <= DECLINE_MAX_LENGTH
  );
}

/**
 * A decline is brief, and the ceiling comes from real answers.
 *
 * The first live run flagged "What can you do?" as a refusal: an 862-character
 * capability overview, no query, no figures, matching the vocabulary once on
 * "I can't access private balances for other members". Describing limits is
 * exactly what that answer is *for*, so length is what separates it from a
 * decline — the genuine decline in the same run ran 190 characters. This sits
 * at roughly twice that, well clear of a real one and well under an overview.
 */
const DECLINE_MAX_LENGTH = 400;

/**
 * A note on clarifying questions, and why there is no exemption for them.
 *
 * A gated chip answered with a question back to the user — "Do you mean League
 * Challenges, or challenges in a Scout competition?" — uses the gated feature
 * no more than a refusal does, and three attempts were made to let it pass:
 * an answer ending in a question mark, then one whose statement prose was
 * short, then one whose statement prose survived removing the questions.
 *
 * Each attempt was defeated by the same thing. The leak this signal exists to
 * catch is prose, and prose can be shaped like a question: `Dare: Play Teemo
 * support and get 10 kills, want to review it?` is a drafted dare for a guild
 * with dares off, has no rows, fits any length ceiling, and leaves nothing
 * behind once questions are removed. Separating it from a real clarification
 * needs to understand what the text says, which a predicate here cannot.
 *
 * So the exemption is gone. A clarifying question on a gated chip raises
 * `gated_chip_did_not_refuse` and a person reads it — which costs a few known
 * rows of noise per sweep, against a rule that can no longer hide the leak it
 * was written to find.
 */

function answeredSomething(answer: string | null): boolean {
  return answer !== null && answer.trim() !== "";
}

function outcomeSignals(input: ReplaySignalInput): readonly ReplaySignal[] {
  const signals: ReplaySignal[] = [];
  if (input.status === "timeout") signals.push("new_turn_timed_out");
  if (input.status === "error") signals.push("new_turn_errored");
  // Only meaningful for a turn that claims to have finished: an errored turn
  // has no answer by construction, and saying so twice buries the real cause.
  if (input.status === "ok" && !answeredSomething(input.answer)) {
    signals.push("new_answer_empty");
  }
  if (input.queryFailedUnrecovered) signals.push("new_query_failed");
  if (
    input.baselineRowsReturned !== null &&
    input.baselineRowsReturned > 0 &&
    input.candidateRowsReturned === 0
  ) {
    signals.push("rows_zero_was_nonzero");
  }
  return signals;
}

function comparisonSignals(
  input: ReplaySignalInput,
  answer: string,
): readonly ReplaySignal[] {
  if (input.diff === null) return [];
  const signals: ReplaySignal[] = [];
  const baselineHadSubstance =
    input.diff.answer.baselineLength > 0 &&
    ((input.baselineRowsReturned ?? 0) > 0 ||
      input.diff.answer.numbersOnlyInBaseline.length > 0);
  if (
    baselineHadSubstance &&
    declinedToAnswer({ answer, rowsReturned: input.candidateRowsReturned })
  ) {
    signals.push("refusal_regression");
  }
  if (input.diff.answer.numbersOnlyInBaseline.length > 0) {
    signals.push("numeric_claim_dropped");
  }
  return signals;
}

function profileSignals(
  input: ReplaySignalInput,
  answer: string,
): readonly ReplaySignal[] {
  // `either` asserts nothing: both behaviours are defensible for that chip.
  if (input.chipExpectation === null || input.chipExpectation === "either") {
    return [];
  }
  if (input.chipExpectation === "gated-off") {
    // Absence of the vocabulary, which is the direction it is reliable in. A
    // clarifying question is not exempt; see the note above.
    return looksLikeExploreRefusal(answer) ? [] : ["gated_chip_did_not_refuse"];
  }
  return declinedToAnswer({
    answer,
    rowsReturned: input.candidateRowsReturned,
  })
    ? ["ungated_chip_refused"]
    : [];
}

export function replaySignals(
  input: ReplaySignalInput,
): readonly ReplaySignal[] {
  const answer = input.answer;
  const hasAnswer = answeredSomething(answer) && answer !== null;
  return [
    ...outcomeSignals(input),
    ...(hasAnswer ? comparisonSignals(input, answer) : []),
    ...(input.capabilityMismatches.length > 0
      ? (["capability_mismatch"] as const)
      : []),
    ...(hasAnswer ? profileSignals(input, answer) : []),
  ];
}

/**
 * Roughly how much a case wants reading, so a summary can lead with the worst.
 *
 * Ordering only. The numbers mean nothing outside a comparison between two
 * cases in the same run, and no threshold turns a total into a verdict.
 */
const SIGNAL_WEIGHT: Readonly<Record<ReplaySignal, number>> = {
  new_turn_errored: 100,
  new_turn_timed_out: 90,
  capability_mismatch: 80,
  new_answer_empty: 70,
  new_query_failed: 60,
  refusal_regression: 50,
  gated_chip_did_not_refuse: 45,
  ungated_chip_refused: 40,
  rows_zero_was_nonzero: 30,
  numeric_claim_dropped: 20,
};

export function replaySignalWeight(signals: readonly ReplaySignal[]): number {
  return signals.reduce((total, signal) => total + SIGNAL_WEIGHT[signal], 0);
}

/**
 * Did the harness itself work?
 *
 * Deliberately narrow. A run "passes" when every case actually ran and the
 * configuration was what it claimed — not when the answers were good. Answer
 * quality is not auto-scored here, so a green result must never be read as
 * "no regression".
 */
export function harnessIntegritySignals(
  signals: readonly ReplaySignal[],
): readonly ReplaySignal[] {
  return signals.filter(
    (signal) =>
      signal === "new_turn_errored" ||
      signal === "new_turn_timed_out" ||
      signal === "capability_mismatch",
  );
}
