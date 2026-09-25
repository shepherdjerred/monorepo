import { describe, expect, test } from "vitest";
import type { ReplayBaseline, ReplaySide } from "./diff.ts";
import type { ExploreCapabilitySet } from "./profiles.ts";
import {
  queryFailedUnrecovered,
  scoreCase,
  type ScorableCase,
} from "./scoring.ts";

const CAPS: ExploreCapabilitySet = {
  bucks: true,
  dares: true,
  challenges: true,
  creation: false,
  riotHistory: false,
  mvpVotes: false,
  clash: false,
  hallOfFame: false,
};

const SIDE: ReplaySide = {
  answer: "Ezreal leads at 54% over 210 games.",
  queryText: "from matches select champion",
  caveats: [],
  followUps: [],
  rowsReturned: 10,
  rowsScanned: 100,
  toolNames: ["run_report_query"],
  matchCardIds: [],
  visualizationKind: null,
};

function scorable(overrides: Partial<ScorableCase> = {}): ScorableCase {
  return {
    status: "ok",
    answer: SIDE.answer,
    trace: [{ toolName: "run_report_query", status: "succeeded" }],
    rowsReturned: 10,
    capabilities: CAPS,
    condition: "always",
    capabilityMismatches: [],
    candidate: SIDE,
    comparison: { kind: "none" },
    normalizeQuery: (text) => text,
    ...overrides,
  };
}

describe("queryFailedUnrecovered", () => {
  test("is true when the last query failed after an earlier success", () => {
    // The shape an "any success" test suppresses: the turn queried fine, broke
    // on its final attempt, and answered on partial data.
    expect(
      queryFailedUnrecovered([
        { toolName: "run_report_query", status: "succeeded" },
        { toolName: "run_report_query", status: "failed" },
      ]),
    ).toBe(true);
  });

  test("is false when a success follows the last of several failures", () => {
    expect(
      queryFailedUnrecovered([
        { toolName: "run_report_query", status: "failed" },
        { toolName: "run_report_query", status: "succeeded" },
        { toolName: "run_report_query", status: "failed" },
        { toolName: "run_report_query", status: "succeeded" },
      ]),
    ).toBe(false);
  });

  test("is false when a failure was followed by a success", () => {
    // Twelve of thirteen failures in the first full beta sweep did exactly
    // this and went on to answer well.
    expect(
      queryFailedUnrecovered([
        { toolName: "run_report_query", status: "failed" },
        { toolName: "run_report_query", status: "succeeded" },
      ]),
    ).toBe(false);
  });

  test("is true when no query ever ran", () => {
    expect(
      queryFailedUnrecovered([
        { toolName: "run_report_query", status: "failed" },
        { toolName: "run_report_query", status: "failed" },
      ]),
    ).toBe(true);
  });

  test("ignores other tools failing", () => {
    expect(
      queryFailedUnrecovered([{ toolName: "load_skill", status: "failed" }]),
    ).toBe(false);
  });

  test("is false for a turn that never queried", () => {
    expect(queryFailedUnrecovered([])).toBe(false);
  });
});

describe("scoreCase", () => {
  test("a clean case produces no signals and no diff", () => {
    const scored = scoreCase(scorable());
    expect(scored.signals).toEqual([]);
    expect(scored.diff).toBeNull();
  });

  test("produces a diff only when a baseline is supplied", () => {
    const baseline: ReplayBaseline = {
      ...SIDE,
      source: "run",
      createdAt: null,
    };
    const scored = scoreCase(
      scorable({ comparison: { kind: "baseline", baseline } }),
    );
    expect(scored.diff).not.toBeNull();
    expect(scored.diff?.answer.identical).toBe(true);
  });

  test("carries a dropped figure through to a signal", () => {
    const baseline: ReplayBaseline = {
      ...SIDE,
      source: "run",
      createdAt: null,
    };
    const scored = scoreCase(
      scorable({
        comparison: { kind: "baseline", baseline },
        answer: "Ezreal leads.",
        candidate: { ...SIDE, answer: "Ezreal leads." },
      }),
    );
    expect(scored.signals).toContain("numeric_claim_dropped");
  });

  test("a stored diff reaches the same signals as the baseline that made it", () => {
    // What re-scoring depends on. `explore:summarize` cannot rebuild a diff —
    // the baseline lived in another bundle — so a recorded one has to carry
    // the baseline-dependent signals on its own.
    const baseline: ReplayBaseline = {
      ...SIDE,
      source: "run",
      createdAt: null,
    };
    const fromBaseline = scoreCase(
      scorable({
        comparison: { kind: "baseline", baseline },
        answer: "Ezreal leads.",
        candidate: { ...SIDE, answer: "Ezreal leads." },
      }),
    );
    expect(fromBaseline.diff).not.toBeNull();
    expect(fromBaseline.signals).toContain("numeric_claim_dropped");

    const storedDiff = fromBaseline.diff;
    if (storedDiff === null) throw new Error("expected a diff");
    const fromStored = scoreCase(
      scorable({
        comparison: { kind: "diff", diff: storedDiff },
        answer: "Ezreal leads.",
        candidate: { ...SIDE, answer: "Ezreal leads." },
      }),
    );
    expect(fromStored.signals).toEqual(fromBaseline.signals);
  });

  test("recovers the baseline row count from a stored delta", () => {
    // `rows_zero_was_nonzero` is decided on the baseline's row count, which a
    // re-score has only as the delta the run recorded.
    const baseline: ReplayBaseline = {
      ...SIDE,
      source: "run",
      createdAt: null,
      rowsReturned: 12,
    };
    const fromBaseline = scoreCase(
      scorable({
        comparison: { kind: "baseline", baseline },
        rowsReturned: 0,
        candidate: { ...SIDE, rowsReturned: 0 },
      }),
    );
    expect(fromBaseline.signals).toContain("rows_zero_was_nonzero");

    const storedDiff = fromBaseline.diff;
    if (storedDiff === null) throw new Error("expected a diff");
    const fromStored = scoreCase(
      scorable({
        comparison: { kind: "diff", diff: storedDiff },
        rowsReturned: 0,
        candidate: { ...SIDE, rowsReturned: 0 },
      }),
    );
    expect(fromStored.signals).toContain("rows_zero_was_nonzero");
  });

  test("normalizes queries so formatting is not a difference", () => {
    const baseline: ReplayBaseline = {
      ...SIDE,
      source: "run",
      createdAt: null,
      queryText: "from   matches   select champion",
    };
    const scored = scoreCase(
      scorable({
        comparison: { kind: "baseline", baseline },
        normalizeQuery: (text) => text.replaceAll(/\s+/g, " "),
      }),
    );
    expect(scored.diff?.query.status).toBe("identical");
  });

  test("asserts nothing for a conversation turn, which has no condition", () => {
    const scored = scoreCase(
      scorable({ condition: null, answer: "I can't do that." }),
    );
    expect(scored.signals).not.toContain("ungated_chip_refused");
  });

  test("flags a capability mismatch wherever it came from", () => {
    const scored = scoreCase(
      scorable({
        capabilityMismatches: ["bucks: captured true, resolved false"],
      }),
    );
    expect(scored.signals).toContain("capability_mismatch");
  });
});
