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
    baseline: null,
    normalizeQuery: (text) => text,
    ...overrides,
  };
}

describe("queryFailedUnrecovered", () => {
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
    const scored = scoreCase(scorable({ baseline }));
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
        baseline,
        answer: "Ezreal leads.",
        candidate: { ...SIDE, answer: "Ezreal leads." },
      }),
    );
    expect(scored.signals).toContain("numeric_claim_dropped");
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
        baseline,
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
