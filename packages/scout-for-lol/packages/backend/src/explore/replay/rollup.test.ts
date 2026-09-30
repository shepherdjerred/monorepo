import { describe, expect, test } from "vitest";
import {
  RollupCaseSchema,
  queryReach,
  rollupByCondition,
  signalTally,
  worstCases,
  type RollupCase,
} from "./rollup.ts";

function rollupCase(overrides: Partial<RollupCase> = {}): RollupCase {
  return RollupCaseSchema.parse({
    caseId: "chip:aaa",
    condition: "always",
    category: "champions",
    expectation: "answerable",
    status: "ok",
    signals: [],
    answerLength: 200,
    rowsReturned: 10,
    toolNames: ["run_report_query"],
    queried: true,
    ...overrides,
  });
}

describe("RollupCaseSchema", () => {
  test("rejects a signal it does not know", () => {
    // Parsed as the enum so an unknown signal fails at the boundary rather
    // than silently weighing nothing in the ordering.
    expect(() =>
      RollupCaseSchema.parse({ ...rollupCase(), signals: ["made_up"] }),
    ).toThrow();
  });
});

describe("rollupByCondition", () => {
  test("groups and counts cases per condition", () => {
    const rows = rollupByCondition([
      rollupCase({ condition: "bucks" }),
      rollupCase({ condition: "bucks" }),
      rollupCase({ condition: "always" }),
    ]);
    expect(rows.find((row) => row.condition === "bucks")?.cases).toBe(2);
    expect(rows.find((row) => row.condition === "always")?.cases).toBe(1);
  });

  test("counts only the two expectation-violating signals", () => {
    const rows = rollupByCondition([
      rollupCase({ condition: "bucks", signals: ["ungated_chip_refused"] }),
      rollupCase({
        condition: "bucks",
        signals: ["gated_chip_did_not_refuse"],
      }),
      // Not a contradiction of the guild's capabilities, so not a violation.
      rollupCase({ condition: "bucks", signals: ["numeric_claim_dropped"] }),
    ]);
    expect(rows[0]?.violations).toBe(2);
  });

  test("reports mixed when a condition was both gated and ungated", () => {
    const rows = rollupByCondition([
      rollupCase({ condition: "bucks", expectation: "answerable" }),
      rollupCase({ condition: "bucks", expectation: "gated-off" }),
    ]);
    expect(rows[0]?.expectation).toBe("mixed");
  });

  test("puts the conditions with the most violations first", () => {
    const rows = rollupByCondition([
      rollupCase({ condition: "quiet" }),
      rollupCase({ condition: "loud", signals: ["ungated_chip_refused"] }),
    ]);
    expect(rows[0]?.condition).toBe("loud");
  });

  test("takes the median answer length, not the mean", () => {
    const rows = rollupByCondition([
      rollupCase({ answerLength: 10 }),
      rollupCase({ answerLength: 20 }),
      rollupCase({ answerLength: 3000 }),
    ]);
    expect(rows[0]?.medianAnswerLength).toBe(20);
  });

  test("labels a condition with no expectation as none", () => {
    const rows = rollupByCondition([rollupCase({ expectation: null })]);
    expect(rows[0]?.expectation).toBe("none");
  });
});

describe("signalTally", () => {
  test("counts every signal occurrence, commonest first", () => {
    expect(
      signalTally([
        rollupCase({ signals: ["ungated_chip_refused"] }),
        rollupCase({ signals: ["ungated_chip_refused", "new_query_failed"] }),
      ]),
    ).toEqual([
      { signal: "ungated_chip_refused", count: 2 },
      { signal: "new_query_failed", count: 1 },
    ]);
  });

  test("is empty for a clean sweep", () => {
    expect(signalTally([rollupCase()])).toEqual([]);
  });
});

describe("worstCases", () => {
  test("orders by signal weight and drops clean cases", () => {
    const result = worstCases(
      [
        rollupCase({ caseId: "clean" }),
        rollupCase({ caseId: "mild", signals: ["numeric_claim_dropped"] }),
        rollupCase({ caseId: "severe", signals: ["new_turn_errored"] }),
      ],
      10,
    );
    expect(result.map((entry) => entry.caseId)).toEqual(["severe", "mild"]);
  });

  test("respects the limit", () => {
    expect(
      worstCases(
        [
          rollupCase({ caseId: "a", signals: ["new_turn_errored"] }),
          rollupCase({ caseId: "b", signals: ["new_turn_errored"] }),
        ],
        1,
      ),
    ).toHaveLength(1);
  });
});

describe("queryReach", () => {
  test("separates cases that queried from ones that answered anyway", () => {
    // The number worth looking at first in an analytics eval: an answer with
    // no query behind it rests on the prompt, not the data.
    expect(
      queryReach([
        rollupCase({ queried: true }),
        rollupCase({ queried: false }),
        rollupCase({ queried: false, status: "error" }),
      ]),
    ).toEqual({ queried: 1, answeredWithoutQuery: 1, total: 3 });
  });
});
