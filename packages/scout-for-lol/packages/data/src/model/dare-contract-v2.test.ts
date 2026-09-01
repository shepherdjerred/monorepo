import { describe, expect, test } from "vitest";
import { DARE_V2_TEST_CONTRACT_BASE } from "./dare-contract-v2.test-fixtures.ts";
import { DareContractV2Schema } from "./dare-contract-v2.ts";

describe("Dare v2 compiler artifact compatibility", () => {
  test("keeps compiler v1 contracts parseable without relational artifacts", () => {
    expect(
      DareContractV2Schema.parse({
        ...DARE_V2_TEST_CONTRACT_BASE,
        compilerVersion: "dare-scoutql-1",
      }).compilerVersion,
    ).toBe("dare-scoutql-1");
  });

  test("requires immutable artifacts for compiler v2 contracts", () => {
    expect(
      DareContractV2Schema.safeParse({
        ...DARE_V2_TEST_CONTRACT_BASE,
        compilerVersion: "dare-scoutql-2",
      }).success,
    ).toBe(false);

    const contract = DareContractV2Schema.parse({
      ...DARE_V2_TEST_CONTRACT_BASE,
      compilerVersion: "dare-scoutql-2",
      scoutQlImmutableAst: "immutable-ast",
      scoutQlPlanHash: "0".repeat(64),
    });
    expect(contract.compilerVersion).toBe("dare-scoutql-2");
  });
});
