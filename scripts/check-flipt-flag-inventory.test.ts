import { describe, expect, test } from "vitest";
import {
  managedFlagInventory,
  managedFlagNamespaces,
  materializeManagedNamespaceEnvironment,
  type ManagedFlag,
} from "../packages/feature-flags/src/managed-flag-inventory.ts";
import {
  checkManagedFlagMatrix,
  selectedManagedEnvironments,
  selectedManagedNamespaces,
} from "./check-flipt-flag-inventory.ts";

function snapshotFlag(flag: ManagedFlag) {
  return {
    key: flag.key,
    enabled: flag.type === "boolean" ? flag.default : true,
    type: flag.type === "boolean" ? "BOOLEAN_FLAG_TYPE" : "VARIANT_FLAG_TYPE",
    defaultVariant: flag.type === "variant" ? { key: flag.default } : undefined,
    rules: flag.rules,
    rollouts: [
      ...flag.rollouts.map((rollout, rank) => ({
        type: "SEGMENT_ROLLOUT_TYPE",
        rank,
        segment: {
          value: rollout.result,
          segmentOperator: rollout.segmentOperator,
          segments: [
            {
              key: rollout.segmentKey,
              matchType: rollout.matchType,
              constraints: rollout.constraints,
            },
          ],
        },
      })),
      ...flag.thresholdRollouts.map((rollout) => ({
        type: "THRESHOLD_ROLLOUT_TYPE",
        rank: rollout.rank,
        threshold: {
          percentage: rollout.percentage,
          value: rollout.result,
        },
      })),
    ],
  };
}

function alignedSnapshot(environment: string, namespace: string) {
  return {
    flags: materializeManagedNamespaceEnvironment(
      managedFlagInventory,
      environment,
      namespace,
    ).map((flag) => snapshotFlag(flag)),
  };
}

describe("check-flipt-flag-inventory", () => {
  test("checks the complete environment and namespace matrix by default", async () => {
    const loaded: string[] = [];
    const messages = await checkManagedFlagMatrix({
      loadSnapshot: (environment, namespace) => {
        loaded.push(`${environment}/${namespace}`);
        return Promise.resolve(alignedSnapshot(environment, namespace));
      },
    });

    expect(loaded).toEqual(
      ["beta", "prod"].flatMap((environment) =>
        managedFlagNamespaces.map((namespace) => `${environment}/${namespace}`),
      ),
    );
    expect(messages).toHaveLength(12);
  });

  test("checks only exact environment and namespace filters", async () => {
    const loaded: string[] = [];
    await checkManagedFlagMatrix({
      namespaceFilter: "scout",
      environmentFilter: "beta",
      loadSnapshot: (environment, namespace) => {
        loaded.push(`${environment}/${namespace}`);
        return Promise.resolve(alignedSnapshot(environment, namespace));
      },
    });
    expect(loaded).toEqual(["beta/scout"]);
    expect(() => selectedManagedEnvironments("staging")).toThrow(
      /unknown managed environment filter: staging/,
    );
    expect(() => selectedManagedNamespaces("default")).toThrow(
      /unknown managed namespace filter: default/,
    );
  });

  test("names the failing namespace and environment for malformed snapshots and drift", async () => {
    await expect(
      checkManagedFlagMatrix({
        namespaceFilter: "scout",
        environmentFilter: "prod",
        loadSnapshot: () => Promise.resolve({ flags: [] }),
      }),
    ).rejects.toThrow(/prod\/scout/);

    await expect(
      checkManagedFlagMatrix({
        namespaceFilter: "temporal",
        environmentFilter: "beta",
        loadSnapshot: () => Promise.resolve({ invalid: true }),
      }),
    ).rejects.toThrow(/beta\/temporal/);
  });

  test("checks the remaining matrix after one pair fails", async () => {
    const loaded: string[] = [];
    await expect(
      checkManagedFlagMatrix({
        loadSnapshot: (environment, namespace) => {
          loaded.push(`${environment}/${namespace}`);
          return Promise.resolve(
            environment === "beta" && namespace === "scout"
              ? { flags: [] }
              : alignedSnapshot(environment, namespace),
          );
        },
      }),
    ).rejects.toThrow(/beta\/scout/);
    expect(loaded).toHaveLength(12);
  });
});
