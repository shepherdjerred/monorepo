import { expect, test } from "vitest";
import { z } from "zod";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
} from "./managed-flag-inventory.ts";

test("beta RAM scratch defaults off and targets canaries only", () => {
  const flag = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    "beta",
    "woodpecker",
  ).find((entry) => entry.key === "woodpecker-ram-scratch-enabled");
  expect(flag).toMatchObject({
    default: false,
    rules: [],
    thresholdRollouts: [],
    rollouts: [
      {
        result: true,
        constraints: [{ property: "stage", operator: "eq", value: "beta" }],
      },
    ],
  });
});

test.each(["beta", "prod"])(
  "%s seed refresh remains restricted to beta targeting",
  (environment) => {
    const producer = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      "temporal",
    ).find((entry) => entry.key === "ci-workspace-seed-refresh-enabled");
    expect(producer).toMatchObject({
      default: false,
      rollouts: [
        {
          segmentKey: "ci-workspace-seed-beta",
          segmentOperator: "OR_SEGMENT_OPERATOR",
          matchType: "ALL_SEGMENT_MATCH_TYPE",
          constraints: [
            {
              type: "STRING_CONSTRAINT_COMPARISON_TYPE",
              property: "stage",
              operator: "eq",
              value: "beta",
            },
          ],
          result: true,
        },
      ],
      rules: [],
      thresholdRollouts: [],
    });
  },
);

const PromotionSettings = z.strictObject({
  model: z.literal("gpt-5.6-luna"),
  maxSteps: z.literal(80),
  timeoutMinutes: z.literal(15),
  monthlySolverUsd: z.literal(10),
  dailySpendUsd: z.literal(5),
  enabledTargets: z.array(z.string().min(1)),
});

const promotionTargets = [
  "pmc",
  "minecraftserver-buzz",
  "reddit-mcservers",
  "disboard-native-bump",
  "discord-mcadverts",
  "discord-lfg-fast",
  "discord-lfg-find-forum",
  "discord-lfg-6-hour",
  "discord-lfg-2-hour",
  "discord-lfg-1-hour",
  "discord-lfg-bedrock",
  "discord-lfg-java",
  "discord-lfg-smp",
  "discord-lfg-5-minute",
  "discord-lfg-15-minute",
  "discord-lfg-30-minute",
];

test("promotion fallback remains off with no audience and beta keeps its exception", () => {
  const enabled = managedFlagInventory.flags.find(
    (flag) => flag.key === "the-storm-promotion-enabled",
  );
  expect(enabled).toMatchObject({
    type: "boolean",
    default: false,
    rollouts: [],
    rules: [],
    thresholdRollouts: [],
  });
  expect(
    enabled?.defaultOffExceptions?.map((entry) => entry.environment),
  ).toEqual(["beta"]);
  const settings = managedFlagInventory.flags.find(
    (flag) => flag.key === "the-storm-promotion-settings",
  );
  if (settings?.type !== "variant")
    throw new Error("Promotion settings must be declared as a variant");
  expect(
    PromotionSettings.parse(JSON.parse(settings.default)).enabledTargets,
  ).toEqual([]);
});

test.each(["beta", "prod"])(
  "promotion activation keeps %s budgets and audience explicit",
  (environment) => {
    const flags = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      "temporal",
    );
    expect(
      flags.find((flag) => flag.key === "the-storm-promotion-enabled"),
    ).toMatchObject({
      type: "boolean",
      default: environment === "prod",
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });
    const settings = flags.find(
      (flag) => flag.key === "the-storm-promotion-settings",
    );
    if (settings?.type !== "variant")
      throw new Error("Promotion settings must be declared as a variant");
    expect(settings).toMatchObject({
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    });
    const parsed = PromotionSettings.parse(JSON.parse(settings.default));
    expect(parsed.enabledTargets).toEqual(
      environment === "prod" ? promotionTargets : [],
    );
    expect(new Set(parsed.enabledTargets).size).toBe(
      parsed.enabledTargets.length,
    );
    if (environment === "prod") {
      const overrides = managedFlagInventory.environments.find(
        (entry) => entry.key === "prod",
      )?.overrides;
      for (const key of [
        "the-storm-promotion-enabled",
        "the-storm-promotion-settings",
      ])
        expect(
          overrides?.filter((override) => override.key === key),
        ).toHaveLength(1);
    }
  },
);

test.each([
  ["woodpecker", "woodpecker-source-cache-enabled"],
  ["woodpecker", "woodpecker-maintenance-lanes-enabled"],
  ["woodpecker", "woodpecker-ram-scratch-enabled"],
  ["woodpecker", "woodpecker-bun-copyfile-enabled"],
  ["temporal", "ci-maintenance-dispatch-enabled"],
  ["temporal", "ci-workspace-golden-refresh-enabled"],
] as const)(
  "production enables %s/%s with a complete override",
  (namespace, key) => {
    const declared = managedFlagInventory.flags.find(
      (flag) => flag.key === key,
    );
    expect(declared?.default).toBe(false);
    const beta = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "beta",
      namespace,
    ).find((flag) => flag.key === key);
    expect(beta?.default).toBe(false);
    const prod = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      "prod",
      namespace,
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
