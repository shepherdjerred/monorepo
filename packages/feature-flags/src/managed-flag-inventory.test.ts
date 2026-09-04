import { describe, expect, test } from "vitest";
import {
  ManagedFlagInventorySchema,
  managedFlagInventory,
  managedFlagNamespaces,
  materializeManagedNamespaceEnvironment,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";

function inventory(overrides: unknown[] = []) {
  return {
    version: 3,
    namespaces: [
      {
        key: "test",
        name: "Test",
        description: "Test namespace.",
      },
    ],
    environments: [
      { key: "beta", overrides },
      { key: "prod", overrides: [] },
    ],
    flags: [
      {
        key: "example",
        owner: "test",
        namespace: "test",
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
  return materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    environment,
    "scout",
  ).find((flag) => flag.key === "scout-explore-model")?.default;
}

function dareExtendedContractsFlag(environment: string) {
  const flag = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    environment,
    "scout",
  ).find((candidate) => candidate.key === "dare_extended_contracts_enabled");
  if (flag === undefined)
    throw new Error("Dare extended contracts flag missing");
  return flag;
}

describe("ManagedFlagInventorySchema", () => {
  test("uses Luna in both managed environments", () => {
    expect(exploreModel("beta")).toBe("gpt-5.6-luna");
    expect(exploreModel("prod")).toBe("gpt-5.6-luna");
    expect(() =>
      materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "default",
        "scout",
      ),
    ).toThrow(/unknown managed environment/);
    expect(managedFlagNamespaces).toEqual([
      "scout",
      "birmel",
      "streambot",
      "starlight-karma-bot",
      "trmnl-dashboard",
      "temporal",
    ]);
    expect(
      materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "prod",
        "scout",
      ).map((flag) => flag.key),
    ).toContain("scout-temporal-call-graph-tracing");
    expect(
      materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "prod",
        "temporal",
      ).map((flag) => flag.key),
    ).toContain("temporal-call-graph-tracing");
  });

  test("enables extended Dare contracts only for the beta guild", () => {
    const betaFlag = dareExtendedContractsFlag("beta");
    expect(betaFlag.default).toBe(false);
    expect(betaFlag.rollouts).toEqual([
      expect.objectContaining({
        segmentKey: "scout-guild-1337623164146155593",
        result: true,
      }),
    ]);

    const prodFlag = dareExtendedContractsFlag("prod");
    expect(prodFlag.default).toBe(false);
    expect(prodFlag.rollouts).toEqual([]);
  });

  test("materializes a full-state environment override", () => {
    const parsed = ManagedFlagInventorySchema.parse(inventory([fullOverride]));
    expect(
      materializeManagedNamespaceEnvironment(parsed, "beta", "test")[0]
        ?.default,
    ).toBe("luna");
    expect(
      materializeManagedNamespaceEnvironment(parsed, "prod", "test")[0]
        ?.default,
    ).toBe("sol");
    expect(() =>
      materializeManagedNamespaceEnvironment(parsed, "prod", "unknown"),
    ).toThrow(/unknown managed namespace/);
  });

  test("rejects duplicate, unknown, and empty namespaces", () => {
    const duplicate = inventory();
    duplicate.namespaces.push({
      key: "test",
      name: "Duplicate",
      description: "Duplicate namespace.",
    });
    expect(ManagedFlagInventorySchema.safeParse(duplicate).success).toBe(false);

    const unknown = inventory();
    const unknownFlag = unknown.flags[0];
    if (unknownFlag === undefined) throw new Error("test inventory is empty");
    unknownFlag.namespace = "unknown";
    expect(ManagedFlagInventorySchema.safeParse(unknown).success).toBe(false);

    const empty = inventory();
    empty.namespaces.push({
      key: "empty",
      name: "Empty",
      description: "Empty namespace.",
    });
    expect(ManagedFlagInventorySchema.safeParse(empty).success).toBe(false);
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
