import { describe, expect, test } from "vitest";
import { retiredFlagDeclarations } from "./retired-flag-declarations.ts";
import {
  ManagedFlagInventorySchema,
  managedFlagInventory,
  managedFlagNamespaces,
  managedBooleanDefault,
  materializeManagedNamespaceEnvironment,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { classifyManagedBoolean } from "./rollout-state.ts";

test.each(["beta", "prod"])(
  "retires every economy control in %s while retaining standalone Dares",
  (environment) => {
    const flags = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      "scout",
    );
    for (const key of [
      "betting_enabled",
      "betting_player_bet_outcome_dm_enabled",
      "betting_settlement_dm_enabled",
      "bucks_dares_enabled",
      "bucks_transfers_enabled",
      "scout-betting-parlay-ai-model",
    ]) {
      expect(flags.some((flag) => flag.key === key)).toBe(false);
      expect(retiredFlagDeclarations).toContainEqual({
        environment,
        namespace: "scout",
        key,
      });
    }
    expect(flags.some((flag) => flag.key === "dares_enabled")).toBe(true);
  },
);

test.each(["beta", "prod"])(
  "retires the removed Scout report action flag in %s",
  (environment) => {
    const key = "scout_support_report_action_enabled";
    const flags = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      "scout",
    );
    expect(flags.some((flag) => flag.key === key)).toBe(false);
    expect(retiredFlagDeclarations).toContainEqual({
      environment,
      namespace: "scout",
      key,
    });
  },
);

function assertGloballyEnabledBooleanFlag(
  namespace: Parameters<typeof materializeManagedNamespaceEnvironment>[2],
  key: Parameters<typeof managedBooleanDefault>[0],
  expectedMeta?: Record<string, unknown>,
): void {
  for (const environment of ["beta", "prod"] as const) {
    const flag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      namespace,
    ).find((candidate) => candidate.key === key);
    if (flag?.type !== "boolean") {
      throw new Error(`${key} missing in ${environment}`);
    }
    expect(flag).toMatchObject({
      ...expectedMeta,
      type: "boolean",
      default: true,
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });
    expect(classifyManagedBoolean(flag)).toBe("on");
    expect(managedBooleanDefault(key, environment)).toBe(true);
    expect(flag.defaultOffExceptions ?? []).toEqual([]);
  }
}

const streambotMusicFlags = [
  "streambot-music-catalog-enabled",
  "streambot-spotify-links-enabled",
  "streambot-playlists-enabled",
] as const;

test.each(streambotMusicFlags)(
  "enables Streambot music and playlists globally in beta and prod for %s",
  (key) => {
    assertGloballyEnabledBooleanFlag("streambot", key);
  },
);

const streambotEsportsFlags = [
  "streambot-lol-esports-enabled",
  "streambot-lol-autoplay-enabled",
];

test.each(streambotEsportsFlags)(
  "keeps both beta Streambot guilds and global prod enablement for %s",
  (key) => {
    const beta = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "beta",
      "streambot",
    ).find((flag) => flag.key === key);
    if (beta?.type !== "boolean") throw new Error(`${key} missing in beta`);
    expect(beta.default).toBe(false);
    expect(beta.rollouts.map((rollout) => rollout.segmentKey)).toEqual([
      "streambot-guild-1337623164146155593",
      "streambot-guild-208425771172102144",
    ]);
    const prod = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "prod",
      "streambot",
    ).find((flag) => flag.key === key);
    expect(prod).toMatchObject({
      type: "boolean",
      default: true,
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });
  },
);

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
  test.each(["beta", "prod"])(
    "enables Riot account linking globally in %s with an enabled outage default",
    (environment) => {
      const flag = scoutPolicyFlag(environment, "riot_account_linking_enabled");
      if (flag.type !== "boolean") throw new Error("Expected a boolean flag");
      expect(flag).toMatchObject({
        default: true,
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
      expect(classifyManagedBoolean(flag)).toBe("on");
      expect(
        managedBooleanDefault("riot_account_linking_enabled", environment),
      ).toBe(true);
      expect(flag.defaultOffExceptions ?? []).toEqual([]);
    },
  );

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

  test("uses Luna in both managed environments aligned with live Scout", () => {
    expect(exploreModel("beta")).toBe("gpt-6-luna");
    expect(exploreModel("prod")).toBe("gpt-5.6-luna");
    expect(() =>
      materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "default",
        "scout",
      ),
    ).toThrow(/unknown managed environment/);
    expect(managedFlagNamespaces).toEqual([
      "delivery",
      "media",
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
      "golink",
      "feeds",
      "mail",
      "errors",
      "artifacts",
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
    const betaFlag = scoutPolicyFlag("beta", "dares_enabled");
    expect(betaFlag.default).toBe(false);
    expect(betaFlag.rollouts).toEqual([
      expect.objectContaining({
        segmentKey: "scout-guild-1337623164146155593",
        result: true,
      }),
    ]);

    const prodFlag = scoutPolicyFlag("prod", "dares_enabled");
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
  test("enables Scout Client capture and recovery in beta and leaves production to an owner-first Flags rollout", () => {
    for (const key of [
      "scout_client_ingestion",
      "scout_client_result_recovery",
    ] as const) {
      const declared = managedFlagInventory.flags.find(
        (flag) => flag.key === key,
      );
      if (declared?.type !== "boolean") throw new Error(`${key} missing`);
      expect(declared.default).toBe(false);
      expect(scoutPolicyFlag("beta", key)).toMatchObject({
        default: true,
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
      // Production stays off in this declaration. Reconciliation never
      // overwrites live targeting, so the owner, owner's-server and everyone
      // steps are operator Flags changes taken on evidence.
      const production = scoutPolicyFlag("prod", key);
      if (production.type !== "boolean") throw new Error(`${key} type`);
      expect(production).toMatchObject({
        default: false,
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
      expect(classifyManagedBoolean(production)).toBe("off");
      expect(managedBooleanDefault(key, "prod")).toBe(false);
      expect(managedBooleanDefault(key, "beta")).toBe(true);
      expect(declared.defaultOffExceptions).toEqual([
        expect.objectContaining({
          environment: "prod",
          issue: "AI-553",
          reason: expect.stringContaining(
            "Production rollout gated on owner-first evidence (AI-553)",
          ),
          enableWhen: expect.stringMatching(
            /^1\. .*2\. .*3\. Owner only: .*4\. Owner's server, then everyone: /u,
          ),
        }),
      ]);
    }
  });

  test("accepts every released Scout Client build by default", () => {
    expect(
      materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "prod",
        "scout",
      ).find((flag) => flag.key === "scout-client-minimum-version"),
    ).toMatchObject({ type: "variant", default: "0.1.0", rollouts: [] });
  });

  test("keeps Scout evidence recovery on in beta and off in prod, apart from the client flag", () => {
    const key = "scout-evidence-recovery-enabled";
    expect(managedBooleanDefault(key, "beta")).toBe(true);
    expect(managedBooleanDefault(key, "prod")).toBe(false);
    expect(scoutPolicyFlag("prod", key)).toMatchObject({
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });
    expect(
      managedFlagInventory.flags
        .find((flag) => flag.key === key)
        ?.defaultOffExceptions?.map((exception) => exception.environment),
    ).toEqual(["prod"]);
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

  test("rejects empty variant keys before Flags seed validation", () => {
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
    ["the-storm-ip-enforcement-enabled", "the-storm", false],
    ["storm-brain-conversation-enabled", "storm", true],
  ])(
    "keeps the beta rollout and explicit production decision for %s",
    (key, namespace, prodEnabled) => {
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
      expect(prod).toMatchObject({ default: prodEnabled, rollouts: [] });
    },
  );
});

describe("The Storm production gameplay rollout", () => {
  test.each([
    ["the-storm-companions-enabled", "the-storm"],
    ["the-storm-staff-tools-enabled", "the-storm"],
    ["the-storm-identity-enabled", "the-storm"],
    ["the-storm-letters-enabled", "the-storm"],
    ["the-storm-rwf-candidate-visits-enabled", "the-storm"],
    ["the-storm-rwf-host-settings-enabled", "the-storm"],
    ["the-storm-rwf-recording-archive-enabled", "temporal"],
  ])(
    "enables %s in production while the fallback stays off",
    (key, namespace) => {
      expect(
        managedFlagInventory.flags.find((flag) => flag.key === key),
      ).toMatchObject({ default: false, rollouts: [] });

      const prod = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        "prod",
        namespace,
      ).find((flag) => flag.key === key);
      expect(prod).toMatchObject({ default: true, rollouts: [] });
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
  test("enables Photon and aligns the owner allowlist in both environments", () => {
    const betaFlags = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "beta",
      "temporal",
    );
    const prodFlags = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "prod",
      "temporal",
    );

    expect(
      betaFlags.find(
        (candidate) => candidate.key === "temporal-agent-chat-photon-enabled",
      )?.default,
    ).toBe(true);
    expect(
      prodFlags.find(
        (candidate) => candidate.key === "temporal-agent-chat-photon-enabled",
      )?.default,
    ).toBe(true);
    expect(
      betaFlags.find(
        (candidate) => candidate.key === "temporal-agent-chat-photon-owners",
      )?.default,
    ).toBe("+19154335144");
    expect(
      prodFlags.find(
        (candidate) => candidate.key === "temporal-agent-chat-photon-owners",
      )?.default,
    ).toBe("+19154335144");
  });
});

describe("The Storm two-stage chat moderation rollout", () => {
  test.each(["beta", "prod"])(
    "enables async chat moderation globally in %s",
    (environment) => {
      const flag = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        environment,
        "the-storm",
      ).find(
        (candidate) =>
          candidate.key === "the-storm-async-chat-moderation-enabled",
      );
      if (flag?.type !== "boolean") throw new Error("Expected a boolean flag");
      expect(flag).toMatchObject({
        default: true,
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
      expect(classifyManagedBoolean(flag)).toBe("on");
      expect(
        managedBooleanDefault(
          "the-storm-async-chat-moderation-enabled",
          environment,
        ),
      ).toBe(true);
    },
  );
});

describe("Golink first-party rollout", () => {
  test.each([
    "golink-dynamic-aliases-enabled",
    "golink-writes-enabled",
    "golink-telemetry-enabled",
  ] as const)("enables %s globally in beta and prod", (key) => {
    assertGloballyEnabledBooleanFlag("golink", key, {
      owner: "golink",
      namespace: "golink",
      source: "golink",
    });
  });
});

describe("Hub alert email single-sender cutover", () => {
  test("enables alert-dashboard-email-enabled globally in beta and prod", () => {
    assertGloballyEnabledBooleanFlag(
      "alert-dashboard",
      "alert-dashboard-email-enabled",
      {
        owner: "alert-dashboard",
        namespace: "alert-dashboard",
        source: "alert-dashboard",
      },
    );
  });
});

describe("Temporal Renovate LLM delta enrichment rollout", () => {
  test("enables temporal-renovate-llm-delta-enabled globally in beta and prod", () => {
    assertGloballyEnabledBooleanFlag(
      "temporal",
      "temporal-renovate-llm-delta-enabled",
      {
        owner: "temporal",
        namespace: "temporal",
        source: "temporal",
      },
    );
  });
});

describe("Temporal weighted round-robin PR code review rollout", () => {
  test("enables temporal-code-review-enabled and configures default SWRR weights in beta and prod", () => {
    assertGloballyEnabledBooleanFlag(
      "temporal",
      "temporal-code-review-enabled",
      {
        owner: "temporal",
        namespace: "temporal",
        source: "code",
      },
    );

    for (const environment of ["beta", "prod"] as const) {
      const settings = materializeManagedNamespaceEnvironment(
        managedFlagInventory,
        environment,
        "temporal",
      ).find((candidate) => candidate.key === "temporal-code-review-settings");
      if (settings?.type !== "variant") {
        throw new Error(
          `temporal-code-review-settings missing in ${environment}`,
        );
      }
      expect(settings).toMatchObject({
        owner: "temporal",
        namespace: "temporal",
        source: "code",
        type: "variant",
        rollouts: [],
        rules: [],
        thresholdRollouts: [],
      });
      expect(JSON.parse(settings.default)).toEqual({
        weights: {
          coderabbit: 3,
          codex: 1,
          cubic: 0,
          codeant: 0,
          qodo: 0,
          greptile: 0,
        },
        quotaCooldownSeconds: 3600,
        timeoutCooldownSeconds: 900,
        requestRetrySeconds: 720,
        providerTimeoutSeconds: 1500,
      });
    }
  });
});

describe("Scheduled reports auto-remediation and quiet-clear digest rollout", () => {
  test("enables temporal-report-auto-remediation-enabled globally in beta and prod", () => {
    assertGloballyEnabledBooleanFlag(
      "temporal",
      "temporal-report-auto-remediation-enabled",
      {
        owner: "temporal",
        namespace: "temporal",
        source: "temporal",
      },
    );
  });

  test("enables alert-dashboard-daily-digest-quiet-clear globally in beta and prod", () => {
    assertGloballyEnabledBooleanFlag(
      "alert-dashboard",
      "alert-dashboard-daily-digest-quiet-clear",
      {
        owner: "alert-dashboard",
        namespace: "alert-dashboard",
        source: "alert-dashboard",
      },
    );
  });

  test("enables the Hub CI dashboard globally in beta and prod", () => {
    assertGloballyEnabledBooleanFlag(
      "alert-dashboard",
      "alert-dashboard-ci-jobs-enabled",
      {
        owner: "alert-dashboard",
        namespace: "alert-dashboard",
        source: "alert-dashboard",
      },
    );
  });

  test("preserves temporal-daily-report-notifications-enabled prod override and beta exception", () => {
    expect(
      managedBooleanDefault(
        "temporal-daily-report-notifications-enabled",
        "prod",
      ),
    ).toBe(true);
    expect(
      managedBooleanDefault(
        "temporal-daily-report-notifications-enabled",
        "beta",
      ),
    ).toBe(false);
  });
});
