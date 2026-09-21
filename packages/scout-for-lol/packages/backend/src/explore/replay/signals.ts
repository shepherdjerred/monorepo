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
  if (!looksLikeExploreRefusal(input.answer)) return false;
  if ((input.rowsReturned ?? 0) > 0) return false;
  if (numericClaims(input.answer).size > 0) return false;
  return input.answer.length <= DECLINE_MAX_LENGTH;
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
 * Whether the answer handed the question back rather than answering it.
 *
 * A gated chip has two acceptable outcomes, not one. Saying "that feature is
 * off here" is the obvious one. Asking what the person meant is the other: it
 * uses the gated feature exactly as much — which is not at all — and calling
 * it a failure to refuse says the agent did something it did not do.
 *
 * The prod sweep is where this showed up. Three chips for features prod has
 * switched off were flagged as answered. Two were questions back to the user:
 * "Do you mean League Challenges, or challenges in a Scout competition? The
 * answer depends on which challenge system and reward you're referring to."
 * and "I'm not sure what you mean by 'dare terms.' Do you mean popular terms
 * used in League dares, or something specific in Scout?" The third really did
 * draft a dare for a guild with dares off. That case is the finding; the other
 * two were the grader's.
 *
 * A question mark alone cannot separate them, because the leak this signal
 * exists to catch is prose — a drafted dare has no rows and fits well under
 * the length ceiling, so `Dare: "…" Want to review it?` would pass as a
 * clarification and suppress the very finding being looked for. So the
 * question has to be what the answer *is*, not something it ends with: the
 * prose outside the questions is capped, tightly.
 *
 * The ceiling comes from the evidence. The two real clarifications carry 76
 * and 42 characters of statement prose; the drafted dare carries 143 with a
 * question appended. This sits between them, nearer the clarifications,
 * because a clarification may add a sentence of context and not a paragraph of
 * output.
 */
const CLARIFICATION_MAX_STATEMENT_LENGTH = 120;

function askedForClarification(input: {
  readonly answer: string;
  readonly rowsReturned: number | null;
}): boolean {
  if (!input.answer.includes("?")) return false;
  if ((input.rowsReturned ?? 0) > 0) return false;
  if (input.answer.length > DECLINE_MAX_LENGTH) return false;
  // Everything the answer states rather than asks: remove each question — a
  // run of text ending in a question mark — and weigh what is left.
  //
  // Not a sentence split. A closing quote after the full stop defeats one,
  // which is how `…before 15 minutes.\u201d Want to review it?` first slipped
  // through as a clarification: the drafted dare and the question landed in a
  // single piece that was dropped whole for ending in a mark.
  const statements = input.answer.replaceAll(/[^.!?]*\?/g, "").trim();
  return statements.length <= CLARIFICATION_MAX_STATEMENT_LENGTH;
}

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
    // Absence of the vocabulary, which is the direction it is reliable in —
    // plus the other way of not using a gated feature, which is to ask what
    // the person meant instead of answering.
    const rowsReturned = input.candidateRowsReturned;
    const usedTheFeature =
      !looksLikeExploreRefusal(answer) &&
      !askedForClarification({ answer, rowsReturned });
    return usedTheFeature ? ["gated_chip_did_not_refuse"] : [];
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
