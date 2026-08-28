import { describe, expect, test } from "vitest";
import {
  ManagedFlagInventorySchema,
  managedFlagInventory,
  materializeManagedEnvironment,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";

function inventory(overrides: unknown[] = []) {
  return {
    version: 2,
    namespace: "default",
    environments: [
      { key: "beta", overrides },
      { key: "prod", overrides: [] },
    ],
    flags: [
      {
        key: "example",
        owner: "test",
        source: "test",
        purpose: "Exercise environment overrides.",
        type: "variant",
        default: "sol",
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      },
    ],
    exemptions: [],
  };
}

const fullOverride = {
  key: "example",
  type: "variant",
  default: "luna",
  rollouts: [],
  rules: [],
  thresholdRollouts: [],
};

function exploreModel(environment: string) {
  return materializeManagedEnvironment(managedFlagInventory, environment).find(
    (flag) => flag.key === "scout-explore-model",
  )?.default;
}

describe("ManagedFlagInventorySchema", () => {
  test("uses Luna in both managed environments", () => {
    expect(exploreModel("beta")).toBe("gpt-5.6-luna");
    expect(exploreModel("prod")).toBe("gpt-5.6-luna");
    expect(() =>
      materializeManagedEnvironment(managedFlagInventory, "default"),
    ).toThrow(/unknown managed environment/);
  });

  test("materializes a full-state environment override", () => {
    const parsed = ManagedFlagInventorySchema.parse(inventory([fullOverride]));
    expect(materializeManagedEnvironment(parsed, "beta")[0]?.default).toBe(
      "luna",
    );
    expect(materializeManagedEnvironment(parsed, "prod")[0]?.default).toBe(
      "sol",
    );
  });

  test("rejects duplicate environments", () => {
    const value = inventory();
    value.environments[1] = { key: "beta", overrides: [] };
    expect(ManagedFlagInventorySchema.safeParse(value).success).toBe(false);
  });

  test("rejects unknown and duplicate override keys", () => {
    expect(
      ManagedFlagInventorySchema.safeParse(
        inventory([{ ...fullOverride, key: "unknown" }]),
      ).success,
    ).toBe(false);
    expect(
      ManagedFlagInventorySchema.safeParse(
        inventory([fullOverride, fullOverride]),
      ).success,
    ).toBe(false);
  });

  test("rejects type mismatches and partial behavioral overrides", () => {
    expect(
      ManagedFlagInventorySchema.safeParse(
        inventory([{ ...fullOverride, type: "boolean", default: true }]),
      ).success,
    ).toBe(false);
    expect(
      ManagedFlagInventorySchema.safeParse(
        inventory([{ key: "example", type: "variant", default: "luna" }]),
      ).success,
    ).toBe(false);
  });
});
