import {
  DARE_EVALUATOR_V2_VERSIONS,
  DareEvaluatorV2VersionSchema,
} from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import { dareEvaluatorImplementationV2 } from "#src/betting/dares/evaluation/dare-evaluator-registry-v2.ts";

describe("Dare v2 evaluator retention", () => {
  test("resolves every evaluator version accepted by stored contracts", () => {
    for (const version of DARE_EVALUATOR_V2_VERSIONS) {
      expect(dareEvaluatorImplementationV2(version)).toMatchObject({
        evaluateEvidence: expect.any(Function),
        evaluateMatch: expect.any(Function),
        analyzeFinality: expect.any(Function),
        buildProof: expect.any(Function),
      });
    }
  });

  test("fails closed for an evaluator with no retained implementation", () => {
    expect(
      DareEvaluatorV2VersionSchema.safeParse("retired-evaluator").success,
    ).toBe(false);
    expect(() => dareEvaluatorImplementationV2("retired-evaluator")).toThrow(
      "Unsupported Dare v2 evaluator version retired-evaluator.",
    );
  });
});
