import { describe, expect, test } from "vitest";
import { BUCKS_INT32_MAX } from "./bryan-bucks.ts";
import {
  DARE_V2_TEST_CONTRACT_BASE,
  DARE_V2_TEST_GAME_SET,
  DARE_V2_TEST_PLAN,
  DARE_V2_TEST_PREDICATE,
} from "./dare-contract-v2.test-fixtures.ts";
import {
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_PREDICATES,
  DareCompiledPlanV2Schema,
  DareContractV2Schema,
} from "./dare-contract-v2.ts";
import type { DareBooleanExpressionV2 } from "./dare-expression-v2.ts";

const CONTRACT = {
  ...DARE_V2_TEST_CONTRACT_BASE,
  compilerVersion: "dare-scoutql-1",
};

function nestedNotExpression(depth: number): DareBooleanExpressionV2 {
  return depth === 1
    ? DARE_V2_TEST_PREDICATE
    : { kind: "not", operand: nestedNotExpression(depth - 1) };
}

describe("Dare v2 durable contract limits", () => {
  test("rejects opening stakes outside the Bucks storage domain", () => {
    expect(
      DareContractV2Schema.safeParse({
        ...CONTRACT,
        openingStake: BUCKS_INT32_MAX + 1,
      }).success,
    ).toBe(false);
  });

  test("rejects plans with more than the maximum predicate count", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse({
        ...DARE_V2_TEST_PLAN,
        gameSets: [
          {
            ...DARE_V2_TEST_GAME_SET,
            predicate: {
              kind: "and",
              operands: Array.from(
                { length: DARE_V2_MAX_PREDICATES },
                () => DARE_V2_TEST_PREDICATE,
              ),
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects plans deeper than the expression-depth cap", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse({
        ...DARE_V2_TEST_PLAN,
        gameSets: [
          {
            ...DARE_V2_TEST_GAME_SET,
            predicate: nestedNotExpression(DARE_V2_MAX_EXPRESSION_DEPTH),
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects game sets that exceed the joined-relation cap", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse({
        ...DARE_V2_TEST_PLAN,
        gameSets: [
          {
            ...DARE_V2_TEST_GAME_SET,
            projections: Array.from({ length: 8 }, (_, index) => ({
              name: `related_${index.toString()}`,
              value: {
                kind: "related_participant_count",
                target: "T1",
                relationship: "ally",
                championName: null,
              },
            })),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
