import { expect, test } from "vitest";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
} from "./managed-flag-inventory.ts";

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
