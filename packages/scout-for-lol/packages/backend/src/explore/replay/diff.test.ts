import { describe, expect, test } from "vitest";
import {
  diffReplayCase,
  numericClaims,
  type ReplayBaseline,
  type ReplaySide,
} from "./diff.ts";

const IDENTITY = (text: string): string | null => text;

/**
 * Spread rather than `??` per field.
 *
 * An explicit null is the case under test in several of these — no query, no
 * preview, no stored timestamp — and a nullish fallback would quietly restore
 * the default, making the test assert the opposite of what it reads like.
 * Spreading keeps an absent key on the default and an explicit null as null.
 */
const BASE_SIDE: ReplaySide = {
  answer: "Ezreal, at 54%.",
  queryText: "from matches select champion",
  caveats: [],
  followUps: [],
  rowsReturned: 10,
  rowsScanned: 100,
  toolNames: ["load_skill", "run_report_query"],
  matchCardIds: [],
  visualizationKind: null,
};

const BASE_BASELINE: ReplayBaseline = {
  ...BASE_SIDE,
  source: "stored",
  createdAt: "2026-03-01T00:00:00.000Z",
};

function side(overrides: Partial<ReplaySide> = {}): ReplaySide {
  return { ...BASE_SIDE, ...overrides };
}

function baseline(overrides: Partial<ReplayBaseline> = {}): ReplayBaseline {
  return { ...BASE_BASELINE, ...overrides };
}

function diff(
  baselineOverrides: Partial<ReplayBaseline> = {},
  candidateOverrides: Partial<ReplaySide> = {},
  normalizeQuery: (text: string) => string | null = IDENTITY,
) {
  return diffReplayCase({
    baseline: baseline(baselineOverrides),
    candidate: side(candidateOverrides),
    normalizeQuery,
  });
}

describe("numericClaims", () => {
  test("keeps the sign, so a reversed result is a different claim", () => {
    expect([...numericClaims("You are down -5 LP")]).toEqual(["-5"]);
    expect([...numericClaims("You are up 5 LP")]).toEqual(["5"]);
  });

  test("does not read a range or a date as negative", () => {
    expect([...numericClaims("between 10-20 games")].toSorted()).toEqual([
      "10",
      "20",
    ]);
    expect([...numericClaims("on 2024-05-01")].toSorted()).toEqual([
      "1",
      "2024",
      "5",
    ]);
  });

  test("finds plain figures", () => {
    expect(
      [...numericClaims("Ezreal won 54% of 210 games")].toSorted(),
    ).toEqual(["210", "54"]);
  });

  test("treats thousands separators as the same claim", () => {
    expect(numericClaims("1,234 games").has("1234")).toBe(true);
  });

  test("normalizes a trailing decimal zero", () => {
    // Otherwise the most-read column in the bundle fills with differences that
    // are not differences.
    expect(numericClaims("54.0%")).toEqual(numericClaims("54%"));
  });

  test("keeps a genuine decimal distinct", () => {
    expect(numericClaims("54.5%").has("54.5")).toBe(true);
    expect(numericClaims("54.5%").has("54")).toBe(false);
  });

  test("is empty for no answer", () => {
    expect(numericClaims(null).size).toBe(0);
  });
});

describe("diffReplayCase answers", () => {
  test("reports identical answers", () => {
    expect(diff().answer.identical).toBe(true);
  });

  test("reports a figure the new answer dropped", () => {
    const result = diff({}, { answer: "Ezreal leads." });
    expect(result.answer.identical).toBe(false);
    expect(result.answer.numbersOnlyInBaseline).toEqual(["54"]);
    expect(result.answer.numbersOnlyInCandidate).toEqual([]);
  });

  test("reports a figure the new answer introduced", () => {
    const result = diff({ answer: "Ezreal leads." }, {});
    expect(result.answer.numbersOnlyInCandidate).toEqual(["54"]);
  });

  test("does not report a rephrasing that keeps every figure", () => {
    const result = diff({}, { answer: "At 54%, Ezreal." });
    expect(result.answer.identical).toBe(false);
    expect(result.answer.numbersOnlyInBaseline).toEqual([]);
    expect(result.answer.numbersOnlyInCandidate).toEqual([]);
  });
});

describe("diffReplayCase queries", () => {
  test("normalizes before comparing, so formatting is not a change", () => {
    const result = diff(
      { queryText: "from   matches    select champion" },
      { queryText: "from matches select champion" },
      (text) => text.replaceAll(/\s+/g, " "),
    );
    expect(result.query.status).toBe("identical");
  });

  test("reports a genuinely different query", () => {
    const result = diff({}, { queryText: "from matches select player" });
    expect(result.query.status).toBe("changed");
    expect(result.query.candidate).toBe("from matches select player");
  });

  test("distinguishes a query that appeared from one that vanished", () => {
    expect(diff({ queryText: null }, {}).query.status).toBe("added");
    expect(diff({}, { queryText: null }).query.status).toBe("removed");
  });

  test("reports absent when neither side queried", () => {
    expect(diff({ queryText: null }, { queryText: null }).query.status).toBe(
      "absent",
    );
  });

  test("falls back to raw text when normalization fails", () => {
    // Worse than normalized, but never silently wrong.
    const result = diff({}, {}, () => null);
    expect(result.query.status).toBe("identical");
  });
});

describe("diffReplayCase tool calls", () => {
  test("reports an added and a removed tool", () => {
    const result = diff({}, { toolNames: ["load_skill", "resolve_player"] });
    expect(result.toolCalls.added).toEqual(["resolve_player"]);
    expect(result.toolCalls.removed).toEqual(["run_report_query"]);
  });

  test("reports a retry the candidate no longer needed", () => {
    // The case set semantics got wrong: both sides use the same tools, but the
    // baseline called one of them twice. Collapsing to sets reports nothing
    // changed and hides the retry the trace is read for.
    const result = diff(
      { toolNames: ["load_skill", "run_report_query", "run_report_query"] },
      { toolNames: ["load_skill", "run_report_query"] },
    );
    expect(result.toolCalls.removed).toEqual(["run_report_query"]);
    expect(result.toolCalls.added).toEqual([]);
  });

  test("reports a retry the candidate newly needed", () => {
    const result = diff(
      { toolNames: ["load_skill", "run_report_query"] },
      { toolNames: ["load_skill", "run_report_query", "run_report_query"] },
    );
    expect(result.toolCalls.added).toEqual(["run_report_query"]);
    expect(result.toolCalls.removed).toEqual([]);
  });

  test("reports reordering only when the tools themselves are unchanged", () => {
    const result = diff({}, { toolNames: ["run_report_query", "load_skill"] });
    expect(result.toolCalls.reordered).toBe(true);
    expect(result.toolCalls.added).toEqual([]);
    expect(result.toolCalls.removed).toEqual([]);
  });

  test("does not call a changed tool set reordered", () => {
    const result = diff({}, { toolNames: ["resolve_player"] });
    expect(result.toolCalls.reordered).toBe(false);
  });

  test("identical sequences are neither changed nor reordered", () => {
    const result = diff();
    expect(result.toolCalls.reordered).toBe(false);
    expect(result.toolCalls.added).toEqual([]);
  });
});

describe("diffReplayCase rows and extras", () => {
  test("reports row deltas in the candidate's direction", () => {
    const result = diff({}, { rowsReturned: 4, rowsScanned: 90 });
    expect(result.rows.returnedDelta).toBe(-6);
    expect(result.rows.scannedDelta).toBe(-10);
  });

  test("leaves a delta null when either side has no preview", () => {
    const result = diff({ rowsReturned: null }, {});
    expect(result.rows.returnedDelta).toBeNull();
  });

  test("diffs caveats, follow-ups and match cards as sets", () => {
    const result = diff(
      { caveats: ["ARAM only"], matchCardIds: ["m1"] },
      {
        caveats: ["Ranked only"],
        followUps: ["And on ARAM?"],
        matchCardIds: [],
      },
    );
    expect(result.caveats.removed).toEqual(["ARAM only"]);
    expect(result.caveats.added).toEqual(["Ranked only"]);
    expect(result.followUps.added).toEqual(["And on ARAM?"]);
    expect(result.matchCards.removed).toEqual(["m1"]);
  });

  test("notices a visualization appearing", () => {
    expect(diff({}, { visualizationKind: "bar" }).visualizationChanged).toBe(
      true,
    );
  });

  test("carries the baseline source and age for the reviewer", () => {
    const result = diff();
    expect(result.baselineSource).toBe("stored");
    expect(result.baselineCreatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  test("carries a run baseline for a chip, which never shipped an answer", () => {
    const result = diff({ source: "run", createdAt: null });
    expect(result.baselineSource).toBe("run");
    expect(result.baselineCreatedAt).toBeNull();
  });
});
