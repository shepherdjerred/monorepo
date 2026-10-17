import { expect, test } from "vitest";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
} from "./managed-flag-inventory.ts";

test.each(["beta", "prod"])(
  "%s Delivery static archives require explicit publication enablement and retain beta-only targeting",
  (environment) => {
    const flag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      "woodpecker",
    ).find(
      (entry) => entry.key === "woodpecker-delivery-static-archives-enabled",
    );
    expect(flag).toMatchObject({
      type: "boolean",
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
  },
);

test.each(["beta", "prod"])(
  "%s RAM scratch defaults off and targets canaries only",
  (environment) => {
    const flag = materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
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
  },
);

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

test.each([
  ["woodpecker", "woodpecker-source-cache-enabled"],
  ["woodpecker", "woodpecker-maintenance-lanes-enabled"],
  ["temporal", "ci-maintenance-dispatch-enabled"],
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
