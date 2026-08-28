import { describe, expect, test } from "vitest";
import {
  managedFlagInventory,
  materializeManagedEnvironment,
  type ManagedFlag,
} from "../packages/feature-flags/src/managed-flag-inventory.ts";
import {
  checkManagedEnvironments,
  selectedManagedEnvironments,
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

function alignedSnapshot(environment: string) {
  return {
    flags: materializeManagedEnvironment(managedFlagInventory, environment).map(
      (flag) => snapshotFlag(flag),
    ),
  };
}

describe("check-flipt-flag-inventory", () => {
  test("checks every managed environment by default", async () => {
    const loaded: string[] = [];
    const messages = await checkManagedEnvironments({
      namespace: "default",
      loadSnapshot: (_namespace, environment) => {
        loaded.push(environment);
        return Promise.resolve(alignedSnapshot(environment));
      },
    });

    expect(loaded).toEqual(["beta", "prod"]);
    expect(messages).toHaveLength(2);
  });

  test("checks only an exact environment filter", async () => {
    const loaded: string[] = [];
    await checkManagedEnvironments({
      namespace: "default",
      environmentFilter: "beta",
      loadSnapshot: (_namespace, environment) => {
        loaded.push(environment);
        return Promise.resolve(alignedSnapshot(environment));
      },
    });
    expect(loaded).toEqual(["beta"]);
    expect(() => selectedManagedEnvironments("staging")).toThrow(
      /unknown managed environment filter: staging/,
    );
  });

  test("names the failing environment for malformed snapshots and drift", async () => {
    await expect(
      checkManagedEnvironments({
        namespace: "default",
        environmentFilter: "prod",
        loadSnapshot: () => Promise.resolve({ flags: [] }),
      }),
    ).rejects.toThrow(/default\/prod/);

    await expect(
      checkManagedEnvironments({
        namespace: "default",
        environmentFilter: "beta",
        loadSnapshot: () => Promise.resolve({ invalid: true }),
      }),
    ).rejects.toThrow(/default\/beta/);
  });
});
