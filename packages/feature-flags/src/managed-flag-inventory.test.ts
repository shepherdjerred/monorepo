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

function scoutPolicyFlag(environment: string, key: string) {
  const flag = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    environment,
    "scout",
  ).find((candidate) => candidate.key === key);
  if (flag === undefined) throw new Error(`Scout policy flag missing: ${key}`);
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
      "alert-dashboard",
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

  test("enables Explore confirmations while keeping unavailable Scout surfaces off in prod", () => {
    expect(scoutPolicyFlag("prod", "explore_creation_enabled")).toMatchObject({
      default: true,
      rollouts: [],
    });

    for (const key of [
      "hall_of_fame_enabled",
      "challenge_runs_enabled",
      "mvp_votes_enabled",
      "voice_assistant_enabled",
    ]) {
      expect(scoutPolicyFlag("prod", key)).toMatchObject({
        default: false,
        rollouts: [],
      });
    }
  });

  test("keeps Birmel image generation off by default, on in beta, and ramped in prod", () => {
    const declared = managedFlagInventory.flags.find(
      (flag) => flag.key === "birmel-image-generation-enabled",
    );
    expect(declared?.default).toBe(false);

    const betaFlag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "beta",
      "birmel",
    ).find((candidate) => candidate.key === "birmel-image-generation-enabled");
    expect(betaFlag?.default).toBe(true);

    const prodFlag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "prod",
      "birmel",
    ).find((candidate) => candidate.key === "birmel-image-generation-enabled");
    expect(prodFlag?.default).toBe(false);
    expect(prodFlag?.thresholdRollouts).toEqual([
      {
        rank: 1,
        percentage: 100,
        result: true,
      },
    ]);
  });

  test("opens Scout client ingestion through managed rollouts while its fallback stays off", () => {
    const declared = managedFlagInventory.flags.find(
      (flag) => flag.key === "scout_client_ingestion",
    );
    expect(declared?.default).toBe(false);

    expect(scoutPolicyFlag("beta", "scout_client_ingestion")).toMatchObject({
      default: true,
      thresholdRollouts: [],
    });
    expect(scoutPolicyFlag("prod", "scout_client_ingestion")).toMatchObject({
      default: false,
      thresholdRollouts: [
        {
          rank: 1,
          percentage: 10,
          result: true,
        },
      ],
    });
  });

  test("keeps Custom nights beta-only while production client ingestion ramps", () => {
    expect(
      scoutPolicyFlag("beta", "custom_nights_enabled").rollouts,
    ).toHaveLength(1);
    expect(scoutPolicyFlag("prod", "custom_nights_enabled")).toMatchObject({
      default: false,
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });
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

  test("generated flag keys match managed-flag-inventory.json", async () => {
    const { generateFlagTypesSource } =
      await import("../scripts/generate-flag-types.ts");
    const generatedOnDisk = await Bun.file(
      new URL("managed-flag-keys.generated.ts", import.meta.url),
    ).text();
    const expected = await generateFlagTypesSource();
    expect(generatedOnDisk).toBe(expected);
  });
});

describe("pet dashboard rollout", () => {
  test("keeps the pet dashboard off by default and in beta while prod stays rolled out", () => {
    const declared = managedFlagInventory.flags.find(
      (flag) => flag.key === "pet-dashboard-enabled",
    );
    expect(declared?.default).toBe(false);

    const betaFlag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "beta",
      "trmnl-dashboard",
    ).find((candidate) => candidate.key === "pet-dashboard-enabled");
    expect(betaFlag).toMatchObject({
      default: false,
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });

    const prodFlag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "prod",
      "trmnl-dashboard",
    ).find((candidate) => candidate.key === "pet-dashboard-enabled");
    expect(prodFlag).toMatchObject({
      default: true,
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });
  });
});

describe("Scout V2 post-match ownership", () => {
  test("keeps V2 as the post-match discovery owner in every environment", () => {
    // The rollback switch, not a new surface: merging it must change nothing,
    // so both environments resolve the V2 ownership that already runs.
    for (const environment of ["beta", "prod"]) {
      expect(
        scoutPolicyFlag(environment, "scout_v2_postmatch_ownership_enabled"),
      ).toMatchObject({ default: true, rollouts: [] });
    }
  });
});

describe("Scout V2 prematch ownership", () => {
  test("leaves prematch detection with v1 in every environment", () => {
    // A cutover switch that ramps per stage, not a rollback: merging it must
    // change nothing, so both environments resolve the v1 ownership that
    // already runs, and each ramp records its own environment override.
    for (const environment of ["beta", "prod"]) {
      expect(
        scoutPolicyFlag(environment, "scout_v2_prematch_ownership_enabled"),
      ).toMatchObject({ default: false, rollouts: [] });
    }
  });
});
