import { describe, expect, test } from "vitest";
import {
  budgetErrorOf,
  exploreFailureCode,
} from "#src/explore/runs/run-turn.ts";
import { ExploreBudgetError } from "#src/explore/spending/ledger.ts";

describe("budget error surfacing", () => {
  test("finds a budget error wrapped by the SDK", () => {
    const budget = new ExploreBudgetError("input_limit");
    const wrapped = new Error("stream failed", { cause: budget });
    expect(budgetErrorOf(wrapped)).toBe(budget);
    expect(exploreFailureCode("failed", wrapped)).toBe(
      "explore:budget_exceeded",
    );
  });

  test("ignores unrelated errors", () => {
    expect(budgetErrorOf(new Error("boom"))).toBeNull();
    expect(exploreFailureCode("failed", new Error("boom"))).toBe(
      "explore:execution_failed",
    );
  });
});
