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

function scoutPolicyFlag(environment: string, key: string) {
  const flag = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    environment,
    "scout",
  ).find((candidate) => candidate.key === key);
  if (flag === undefined) throw new Error(`Scout policy flag missing: ${key}`);
  return flag;
}

function verifySportsGuildRollout(): void {
  const sports = managedFlagInventory.flags.find(
    (flag) => flag.key === "streambot-sports-streaming-enabled",
  );
  if (sports === undefined) throw new Error("Streambot sports flag missing");
  expect(sports.default).toBe(false);
  expect(sports.rollouts).toHaveLength(2);
  expect(
    sports.rollouts.every((rollout) =>
      rollout.constraints.every(
        (constraint) => constraint.property === "server",
      ),
    ),
  ).toBe(true);
}

function verifyRwfEnabledEnvironments(key: string): void {
  for (const environment of ["beta", "prod"]) {
    const flag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      "the-storm",
    ).find((candidate) => candidate.key === key);
    expect(flag).toMatchObject({ default: true, rollouts: [] });
  }
}

describe("ManagedFlagInventorySchema", () => {
  test("Scout report support action is enabled in beta only", () => {
    const flag = managedFlagInventory.flags.find(
      ({ key }) => key === "scout_support_report_action_enabled",
    );
    const betaOverride = managedFlagInventory.environments
      .find(({ key }) => key === "beta")
      ?.overrides.find(
        ({ key }) => key === "scout_support_report_action_enabled",
      );

    expect(flag?.default).toBe(false);
    expect(betaOverride?.default).toBe(true);
  });

  test(
    "limits Streambot sports rollout to named guilds",
    verifySportsGuildRollout,
  );

  test("enables Arcade in production while retaining beta targeting and safe defaults", () => {
    const production = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "prod",
      "arcade",
    );
    const beta = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "beta",
      "arcade",
    );
    expect(production).toHaveLength(4);
    for (const flag of production) {
      expect(flag).toMatchObject({
        type: "boolean",
        default: true,
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
      expect(
        managedFlagInventory.flags.find(({ key }) => key === flag.key)?.default,
      ).toBe(false);
      expect(beta.find(({ key }) => key === flag.key)).toMatchObject({
        default: false,
        rollouts: [
          {
            result: true,
            constraints: [
              { property: "environment", operator: "eq", value: "beta" },
            ],
          },
        ],
      });
    }
  });

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
      "arcade",
      "tracker",
      "woodpecker",
      "justin",
      "scout",
      "birmel",
      "streambot",
      "starlight-karma-bot",
      "trmnl-dashboard",
      "temporal",
      "alert-dashboard",
      "the-storm",
      "storm",
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

  test("enables Dares only for the beta guild", () => {
    const betaFlag = scoutPolicyFlag("beta", "bucks_dares_enabled");
    expect(betaFlag.default).toBe(false);
    expect(betaFlag.rollouts).toEqual([
      expect.objectContaining({
        segmentKey: "scout-guild-1337623164146155593",
        result: true,
      }),
    ]);

    const prodFlag = scoutPolicyFlag("prod", "bucks_dares_enabled");
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
});

describe("Managed flag inventory validation", () => {
  test("enables Scout Client capture and recovery only in beta", () => {
    for (const key of [
      "scout_client_ingestion",
      "scout_client_result_recovery",
    ]) {
      expect(
        managedFlagInventory.flags.find((flag) => flag.key === key)?.default,
      ).toBe(false);
      expect(scoutPolicyFlag("beta", key)).toMatchObject({
        default: true,
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
      expect(scoutPolicyFlag("prod", key)).toMatchObject({
        default: false,
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
    }
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

  test("rejects empty variant keys before Flipt seed validation", () => {
    const value = inventory();
    const flag = value.flags[0];
    if (flag === undefined) throw new Error("test inventory is empty");
    flag.default = "";
    expect(ManagedFlagInventorySchema.safeParse(value).success).toBe(false);
    expect(
      ManagedFlagInventorySchema.safeParse(
        inventory([{ ...fullOverride, default: "" }]),
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

describe("The Storm companion pilot rollout", () => {
  test("activates production gameplay and brain features with safe global defaults", () => {
    for (const [namespace, keys] of [
      [
        "the-storm",
        [
          "the-storm-crier-enabled",
          "the-storm-merchant-enabled",
          "the-storm-beginners-luck-enabled",
        ],
      ],
    ] as const) {
      const flags = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "prod",
        namespace,
      );
      for (const key of keys) {
        expect(flags.find((flag) => flag.key === key)).toMatchObject({
          default: true,
        });
        expect(
          managedFlagInventory.flags.find((flag) => flag.key === key),
        ).toMatchObject({ default: false });
      }
    }
  });

  test.each([
    ["the-storm-companions-enabled", "the-storm"],
    ["the-storm-staff-tools-enabled", "the-storm"],
    ["the-storm-identity-enabled", "the-storm"],
    ["the-storm-letters-enabled", "the-storm"],
    ["the-storm-ip-enforcement-enabled", "the-storm"],
    ["storm-brain-conversation-enabled", "storm"],
  ])(
    "enables %s in beta while keeping production and fallback off",
    (key, namespace) => {
      const declared = managedFlagInventory.flags.find(
        (flag) => flag.key === key,
      );
      expect(declared).toMatchObject({ default: false, rollouts: [] });

      const beta = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "beta",
        namespace,
      ).find((flag) => flag.key === key);
      expect(beta).toMatchObject({
        default: true,
        rollouts: [],
      });

      const prod = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "prod",
        namespace,
      ).find((flag) => flag.key === key);
      expect(prod).toMatchObject({ default: false, rollouts: [] });
    },
  );
});

describe("Red Warfare Search and Destroy rollout", () => {
  test("opens /rwf join in beta and production while the fallback stays off", () => {
    const key = "the-storm-rwf-enabled";
    expect(
      managedFlagInventory.flags.find((flag) => flag.key === key),
    ).toMatchObject({
      namespace: "the-storm",
      type: "boolean",
      default: false,
      rollouts: [],
    });

    verifyRwfEnabledEnvironments(key);
  });

  test("lets bots talk in beta and production while the fallback stays silent", () => {
    const key = "the-storm-rwfbots-chat-enabled";
    expect(
      managedFlagInventory.flags.find((flag) => flag.key === key),
    ).toMatchObject({
      namespace: "the-storm",
      source: "the-storm-rwfbots-chat",
      type: "boolean",
      default: false,
      rollouts: [],
    });

    verifyRwfEnabledEnvironments(key);
  });

  test("keeps learned Trooper control off until its accepted bundle is shipped", () => {
    const key = "the-storm-rwfbots-learning-enabled";
    expect(
      managedFlagInventory.flags.find((flag) => flag.key === key),
    ).toMatchObject({
      namespace: "the-storm",
      source: "the-storm-rwfbots-learning",
      type: "boolean",
      default: false,
      rollouts: [],
    });
    for (const environment of ["beta", "prod"]) {
      const flag = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        environment,
        "the-storm",
      ).find((candidate) => candidate.key === key);
      expect(flag?.default).toBe(false);
      expect(flag?.rollouts).toEqual([]);
    }
  });
});

describe("durable iMessage ingress rollout", () => {
  test("enables the beta gateway rollout while prod stays disabled", () => {
    const betaFlag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "beta",
      "temporal",
    ).find(
      (candidate) => candidate.key === "temporal-agent-chat-photon-enabled",
    );
    const prodFlag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "prod",
      "temporal",
    ).find(
      (candidate) => candidate.key === "temporal-agent-chat-photon-enabled",
    );

    expect(betaFlag?.default).toBe(true);
    expect(prodFlag?.default).toBe(false);
  });
});
