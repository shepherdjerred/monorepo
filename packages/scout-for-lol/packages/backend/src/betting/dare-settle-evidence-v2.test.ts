import { describe, expect, test } from "vitest";
import { dareV2EvidencePlanVersion } from "#src/betting/dare-settle-evidence-v2.ts";

describe("Dare v2 evidence plan versions", () => {
  test("preserves the existing two-part tag for compiler-v1 evidence", () => {
    expect(
      dareV2EvidencePlanVersion({
        compilerVersion: "dare-scoutql-1",
        evaluatorVersion: "dare-evaluator-2",
      }),
    ).toBe("dare-scoutql-1:dare-evaluator-2");
  });

  test("binds compiler-v2 evidence to its immutable plan hash", () => {
    expect(
      dareV2EvidencePlanVersion({
        compilerVersion: "dare-scoutql-2",
        evaluatorVersion: "dare-evaluator-2",
        scoutQlPlanHash: "plan-hash",
      }),
    ).toBe("dare-scoutql-2:dare-evaluator-2:plan-hash");
  });

  test("preserves the two-part tag for pre-artifact compiler-v2 evidence", () => {
    expect(
      dareV2EvidencePlanVersion({
        compilerVersion: "dare-scoutql-2",
        evaluatorVersion: "dare-evaluator-2",
      }),
    ).toBe("dare-scoutql-2:dare-evaluator-2");
  });
});
