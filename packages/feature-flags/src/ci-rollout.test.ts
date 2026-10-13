import { expect, test } from "vitest";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
} from "./managed-flag-inventory.ts";

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

test.each([["woodpecker", "woodpecker-source-cache-enabled"]] as const)(
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

test("production maintenance remains manual-only without enabling automatic dispatch", () => {
  const lanes = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    "prod",
    "woodpecker",
  ).find((flag) => flag.key === "woodpecker-maintenance-lanes-enabled");
  expect(lanes).toMatchObject({
    type: "boolean",
    default: false,
    rollouts: [
      {
        segmentKey: "woodpecker-maintenance-manual-beta",
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
  const dispatch = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    "prod",
    "temporal",
  ).find((flag) => flag.key === "ci-maintenance-dispatch-enabled");
  expect(dispatch).toMatchObject({
    type: "boolean",
    default: false,
    rollouts: [],
    rules: [],
    thresholdRollouts: [],
  });
});
