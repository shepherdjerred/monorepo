import { describe, expect, test } from "vitest";
import {
  diffReplayCase,
  type ReplayBaseline,
  type ReplaySide,
} from "./diff.ts";
import {
  declinedToAnswer,
  harnessIntegritySignals,
  replaySignalWeight,
  replaySignals,
  type ReplaySignalInput,
} from "./signals.ts";

const SUBSTANTIVE = "Ezreal leads at 54% over 210 games.";
const DECLINE = "Scout does not track that, so it cannot be answered here.";

const BASE_SIDE: ReplaySide = {
  answer: SUBSTANTIVE,
  queryText: "from matches select champion",
  caveats: [],
  followUps: [],
  rowsReturned: 10,
  rowsScanned: 100,
  toolNames: ["run_report_query"],
  matchCardIds: [],
  visualizationKind: null,
};

function diffFor(
  baselineOverrides: Partial<ReplayBaseline> = {},
  candidateOverrides: Partial<ReplaySide> = {},
) {
  const baseline: ReplayBaseline = {
    ...BASE_SIDE,
    source: "stored",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...baselineOverrides,
  };
  return diffReplayCase({
    baseline,
    candidate: { ...BASE_SIDE, ...candidateOverrides },
    normalizeQuery: (text) => text,
  });
}

const BASE_INPUT: ReplaySignalInput = {
  status: "ok",
  answer: SUBSTANTIVE,
  queryFailedUnrecovered: false,
  diff: null,
  chipExpectation: null,
  capabilityMismatches: [],
  baselineRowsReturned: 10,
  candidateRowsReturned: 10,
};

function signals(overrides: Partial<ReplaySignalInput> = {}) {
  return replaySignals({ ...BASE_INPUT, ...overrides });
}

describe("declinedToAnswer", () => {
  test("accepts a genuine decline that rests on nothing", () => {
    expect(declinedToAnswer({ answer: DECLINE, rowsReturned: 0 })).toBe(true);
  });

  test("does not treat an ordinary negation as a decline", () => {
    // The shared vocabulary contains "does not", so a naive check would fire
    // on a large share of perfectly good answers.
    expect(
      declinedToAnswer({
        answer: "Ezreal does not play mid; he is bot at 54%.",
        rowsReturned: 8,
      }),
    ).toBe(false);
  });

  test("does not treat a negation backed by rows as a decline", () => {
    expect(
      declinedToAnswer({ answer: "That is not the case.", rowsReturned: 3 }),
    ).toBe(false);
  });

  test("does not treat a negation that cites figures as a decline", () => {
    expect(
      declinedToAnswer({
        answer: "Ezreal does not lead; Jinx does, at 56%.",
        rowsReturned: 0,
      }),
    ).toBe(false);
  });

  test("does not treat a long capability overview as a decline", () => {
    // From the first live beta run: "What can you do?" answered with an
    // 862-character overview that says "I can't access private balances",
    // which is the answer doing its job, not declining.
    const overview = `I can help with League match analysis, current League
      reference, Bryan Bucks, dares and challenges. ${"Detail. ".repeat(60)}
      I can't access private balances for other members.`;
    expect(overview.length).toBeGreaterThan(400);
    expect(declinedToAnswer({ answer: overview, rowsReturned: null })).toBe(
      false,
    );
  });

  test("still accepts a real decline of ordinary length", () => {
    // Also from the first live run, at 190 characters.
    const real =
      "I can't provide a server-wide Bryan Bucks balance leaderboard or another member's current balance. I can show your own balance, or summarize guild-wide earnings instead.";
    expect(real.length).toBeLessThan(400);
    expect(declinedToAnswer({ answer: real, rowsReturned: null })).toBe(true);
  });

  test("is false for an answer with no refusal wording at all", () => {
    expect(declinedToAnswer({ answer: "Ezreal leads.", rowsReturned: 0 })).toBe(
      false,
    );
  });
});

describe("replaySignals outcomes", () => {
  test("a clean turn produces nothing", () => {
    expect(signals()).toEqual([]);
  });

  test("flags an errored turn", () => {
    expect(signals({ status: "error", answer: null })).toEqual([
      "new_turn_errored",
    ]);
  });

  test("flags a timeout separately from an error", () => {
    expect(signals({ status: "timeout", answer: null })).toEqual([
      "new_turn_timed_out",
    ]);
  });

  test("does not also call an errored turn empty", () => {
    // Saying it twice buries the real cause.
    expect(signals({ status: "error", answer: null })).not.toContain(
      "new_answer_empty",
    );
  });

  test("flags a finished turn that said nothing", () => {
    expect(signals({ answer: "   " })).toEqual(["new_answer_empty"]);
  });

  test("flags a query failure the turn never recovered from", () => {
    expect(signals({ queryFailedUnrecovered: true })).toEqual([
      "new_query_failed",
    ]);
  });

  test("says nothing when a failed query was retried successfully", () => {
    // Twelve of thirteen failures in the first full beta sweep were recovered
    // in the same turn; flagging those buried the one that was not.
    expect(signals({ queryFailedUnrecovered: false })).toEqual([]);
  });

  test("flags rows going to zero", () => {
    expect(signals({ candidateRowsReturned: 0 })).toContain(
      "rows_zero_was_nonzero",
    );
  });

  test("does not flag rows when the baseline had none either", () => {
    expect(
      signals({ baselineRowsReturned: 0, candidateRowsReturned: 0 }),
    ).not.toContain("rows_zero_was_nonzero");
  });
});

describe("replaySignals comparisons", () => {
  test("flags a substantive baseline that is now a decline", () => {
    const result = signals({
      answer: DECLINE,
      candidateRowsReturned: 0,
      diff: diffFor({}, { answer: DECLINE, rowsReturned: 0 }),
    });
    expect(result).toContain("refusal_regression");
  });

  test("does not flag a decline when the baseline had no substance either", () => {
    const result = signals({
      answer: DECLINE,
      baselineRowsReturned: 0,
      candidateRowsReturned: 0,
      diff: diffFor(
        { answer: DECLINE, rowsReturned: 0 },
        { answer: DECLINE, rowsReturned: 0 },
      ),
    });
    expect(result).not.toContain("refusal_regression");
  });

  test("flags a figure the new answer dropped", () => {
    const result = signals({
      answer: "Ezreal leads.",
      diff: diffFor({}, { answer: "Ezreal leads." }),
    });
    expect(result).toContain("numeric_claim_dropped");
  });

  test("does not flag a rephrasing that keeps every figure", () => {
    const answer = "At 54%, over 210 games, Ezreal leads.";
    const result = signals({ answer, diff: diffFor({}, { answer }) });
    expect(result).not.toContain("numeric_claim_dropped");
  });
});

describe("replaySignals profile assertions", () => {
  test("flags a gated chip that never said the feature was unavailable", () => {
    const result = signals({
      chipExpectation: "gated-off",
      answer: "You have 400 Bryan Bucks.",
    });
    expect(result).toContain("gated_chip_did_not_refuse");
  });

  test("accepts a gated chip that declined", () => {
    const result = signals({
      chipExpectation: "gated-off",
      answer: DECLINE,
      candidateRowsReturned: 0,
    });
    expect(result).not.toContain("gated_chip_did_not_refuse");
  });

  test("flags a clarifying question too, which is known noise", () => {
    // Verbatim from the prod sweep. Letting this pass needed a predicate that
    // could tell a question from a drafted dare shaped like one, and three
    // attempts could not; a few noisy rows beat a rule that hides a leak.
    const result = signals({
      chipExpectation: "gated-off",
      answer:
        "Do you mean League Challenges, or challenges in a Scout competition? The answer depends on which challenge system and reward you’re referring to.",
      candidateRowsReturned: null,
    });
    expect(result).toContain("gated_chip_did_not_refuse");
  });

  test("flags produced output shaped like a question", () => {
    // The case that defeated every exemption: a drafted dare for a guild with
    // dares off, no rows, no sentence punctuation, ending in a question.
    const result = signals({
      chipExpectation: "gated-off",
      answer: "Dare: Play Teemo support and get 10 kills, want to review it?",
      candidateRowsReturned: null,
    });
    expect(result).toContain("gated_chip_did_not_refuse");
  });

  test("still flags a gated chip that produced the feature's output", () => {
    // Also verbatim: prod has dares off, and this turn drafted one anyway.
    // No question mark, so it is not a clarification, and it is the finding
    // the other two were burying.
    const result = signals({
      chipExpectation: "gated-off",
      answer:
        "Dare: “For your next mid-lane game, lock in an assassin and play like you mean it—no safe farming simulator. Get first blood or solo-kill your lane opponent before 15 minutes, or you owe the team a snack.”",
      candidateRowsReturned: null,
    });
    expect(result).toContain("gated_chip_did_not_refuse");
  });

  test("still flags produced output with a follow-up question appended", () => {
    // The leak this signal exists to catch is prose: a drafted dare has no
    // rows and fits the length ceiling, so a trailing question must not buy it
    // a pass.
    const result = signals({
      chipExpectation: "gated-off",
      answer:
        "Dare: “For your next mid-lane game, lock in an assassin and play like you mean it—no safe farming simulator. Get first blood before 15 minutes.” Want to review it?",
      candidateRowsReturned: null,
    });
    expect(result).toContain("gated_chip_did_not_refuse");
  });

  test("does not let a question mark excuse an answer built on rows", () => {
    const result = signals({
      chipExpectation: "gated-off",
      answer: "You have 400 Bryan Bucks. Want the full ledger?",
      candidateRowsReturned: 12,
    });
    expect(result).toContain("gated_chip_did_not_refuse");
  });

  test("flags an available feature the answer declined anyway", () => {
    const result = signals({
      chipExpectation: "answerable",
      answer: DECLINE,
      candidateRowsReturned: 0,
    });
    expect(result).toContain("ungated_chip_refused");
  });

  test("does not flag an available chip whose answer merely contains a negation", () => {
    const result = signals({
      chipExpectation: "answerable",
      answer: "Ezreal does not play mid; he is bot at 54%.",
    });
    expect(result).not.toContain("ungated_chip_refused");
  });

  test("asserts nothing when both behaviours are defensible", () => {
    const result = signals({ chipExpectation: "either", answer: DECLINE });
    expect(result).not.toContain("ungated_chip_refused");
    expect(result).not.toContain("gated_chip_did_not_refuse");
  });

  test("makes no profile assertion for a conversation turn", () => {
    const result = signals({ chipExpectation: null, answer: DECLINE });
    expect(result).not.toContain("ungated_chip_refused");
    expect(result).not.toContain("gated_chip_did_not_refuse");
  });

  test("flags a run that did not resolve the capabilities it promised", () => {
    expect(
      signals({
        capabilityMismatches: ["bucks: expects true, resolved false"],
      }),
    ).toEqual(["capability_mismatch"]);
  });
});

describe("replaySignalWeight", () => {
  test("orders a broken turn above a dropped figure", () => {
    expect(replaySignalWeight(["new_turn_errored"])).toBeGreaterThan(
      replaySignalWeight(["numeric_claim_dropped"]),
    );
  });

  test("is zero for a clean case", () => {
    expect(replaySignalWeight([])).toBe(0);
  });
});

describe("harnessIntegritySignals", () => {
  test("keeps only what says the harness or its configuration failed", () => {
    expect(
      harnessIntegritySignals([
        "new_turn_errored",
        "capability_mismatch",
        "numeric_claim_dropped",
        "refusal_regression",
      ]),
    ).toEqual(["new_turn_errored", "capability_mismatch"]);
  });

  test("treats answer-quality signals as not a harness failure", () => {
    // A green run must never be read as "no regression".
    expect(
      harnessIntegritySignals([
        "numeric_claim_dropped",
        "rows_zero_was_nonzero",
        "ungated_chip_refused",
      ]),
    ).toEqual([]);
  });
});
