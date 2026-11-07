import { describe, expect, test } from "vitest";
import {
  classifyManagedBoolean,
  classifySnapshotBoolean,
} from "./rollout-state.ts";
import {
  defaultOnPolicyViolations,
  managedFlagInventory,
  ManagedFlagInventorySchema,
} from "./managed-flag-inventory.ts";
import type { ManagedFlag } from "./managed-flag-inventory.ts";
import type { SnapshotFlag } from "./managed-flag-drift.ts";
import { FliptProvider } from "./providers/flipt.ts";
import { createFakeFetcher } from "./providers/fake-fetcher.ts";

const baseline = {
  key: "test",
  owner: "test",
  namespace: "test",
  source: "test",
  purpose: "test",
  type: "boolean",
  default: false,
  rollouts: [],
  rules: [],
  thresholdRollouts: [],
} as const satisfies ManagedFlag;

describe("rollout classification", () => {
  test("constant thresholds and ordered targeting agree with the real WASM evaluator", async () => {
    const flags: SnapshotFlag[] = [0, 100].map((percentage) => ({
      key: `threshold-${String(percentage)}`,
      type: "BOOLEAN_FLAG_TYPE",
      enabled: false,
      rules: [],
      rollouts: [
        {
          rank: 1,
          type: "THRESHOLD_ROLLOUT_TYPE",
          threshold: { percentage, value: true },
        },
      ],
    }));
    flags.push({
      key: "ordered",
      type: "BOOLEAN_FLAG_TYPE",
      enabled: true,
      rules: [],
      rollouts: [
        {
          rank: 1,
          type: "SEGMENT_ROLLOUT_TYPE",
          segment: {
            value: false,
            segmentOperator: "OR_SEGMENT_OPERATOR",
            segments: [
              {
                key: "pilot",
                matchType: "ALL_SEGMENT_MATCH_TYPE",
                constraints: [
                  {
                    type: "STRING_CONSTRAINT_COMPARISON_TYPE",
                    property: "cohort",
                    operator: "eq",
                    value: "pilot",
                  },
                ],
              },
            ],
          },
        },
        {
          rank: 2,
          type: "THRESHOLD_ROLLOUT_TYPE",
          threshold: { percentage: 100, value: true },
        },
      ],
    });
    expect(flags.map((flag) => classifySnapshotBoolean(flag))).toEqual([
      "off",
      "on",
      "targeted",
    ]);
    const provider = new FliptProvider({
      url: "http://flipt.invalid",
      namespace: "default",
      environment: "prod",
      pollIntervalSeconds: 300,
      fetcher: createFakeFetcher({
        kind: "snapshot",
        body: {
          namespace: { key: "default" },
          digest: "fixture",
          flags: flags.map((flag) => ({
            ...flag,
            name: flag.key,
            description: "",
            createdAt: "2026-11-07T00:00:00Z",
            updatedAt: "2026-11-07T00:00:00Z",
            rollouts: flag.rollouts.map((rollout) =>
              rollout.type === "SEGMENT_ROLLOUT_TYPE"
                ? {
                    ...rollout,
                    segment: {
                      ...rollout.segment,
                      segments: rollout.segment.segments.map((segment) => ({
                        ...segment,
                        name: segment.key,
                        description: "",
                      })),
                    },
                  }
                : rollout,
            ),
          })),
        },
      }).fetcher,
    });
    try {
      await provider.initialize();
      for (let index = 0; index < 2000; index++) {
        const context = { targetingKey: `entity-${String(index)}` };
        const off = await provider.resolveBooleanEvaluation(
          "threshold-0",
          true,
          context,
        );
        const on = await provider.resolveBooleanEvaluation(
          "threshold-100",
          false,
          context,
        );
        expect(off.errorCode).toBeUndefined();
        expect(on.errorCode).toBeUndefined();
        expect(off.value).toBe(false);
        expect(on.value).toBe(true);
      }
      for (const cohort of ["pilot", "other"]) {
        const result = await provider.resolveBooleanEvaluation(
          "ordered",
          true,
          { targetingKey: cohort, cohort },
        );
        expect(result.errorCode).toBeUndefined();
        expect(result.value).toBe(cohort !== "pilot");
      }
    } finally {
      await provider.onClose();
    }
  });
  test("constants and zero/partial/full thresholds", () => {
    expect(classifyManagedBoolean(baseline)).toBe("off");
    expect(classifyManagedBoolean({ ...baseline, default: true })).toBe("on");
    for (const [percentage, state] of [
      [0, "off"],
      [50, "partial"],
      [100, "on"],
    ] as const) {
      expect(
        classifyManagedBoolean({
          ...baseline,
          thresholdRollouts: [{ rank: 1, percentage, result: true }],
        }),
      ).toBe(state);
    }
  });
  test("a preceding conditional disable survives a later 100% enable", () => {
    const segment = {
      segmentKey: "test",
      segmentOperator: "OR_SEGMENT_OPERATOR",
      matchType: "ALL_SEGMENT_MATCH_TYPE",
      constraints: [],
      result: false,
    };
    expect(
      classifyManagedBoolean({
        ...baseline,
        default: true,
        rollouts: [segment],
        thresholdRollouts: [{ rank: 2, percentage: 100, result: true }],
      }),
    ).toBe("targeted");
    expect(
      classifyManagedBoolean({
        ...baseline,
        default: true,
        rollouts: [segment],
        thresholdRollouts: [{ rank: 1, percentage: 100, result: true }],
      }),
    ).toBe("on");
  });
  test("missing and incompatible live flags are visible", () => {
    expect(classifySnapshotBoolean(undefined)).toBe("missing");
    expect(
      classifySnapshotBoolean({
        key: "test",
        enabled: true,
        type: "VARIANT_FLAG_TYPE",
        rules: [],
        rollouts: [],
      }),
    ).toBe("invalid");
  });
});

describe("default-on governance", () => {
  test("every non-global declaration has a scoped exception", () => {
    expect(defaultOnPolicyViolations(managedFlagInventory)).toEqual([]);
  });
  test("exception dates may expire, but environments and identities must be valid", () => {
    const exception = {
      environment: "prod",
      reason: "owner gate",
      issue: "AI-1",
      enableWhen: "acceptance complete",
      reviewBy: "2020-01-01",
    };
    const value = {
      version: 3,
      namespaces: [{ key: "test", name: "test", description: "test" }],
      environments: [{ key: "prod", overrides: [] }],
      flags: [{ ...baseline, defaultOffExceptions: [exception] }],
      exemptions: [],
    };
    expect(ManagedFlagInventorySchema.safeParse(value).success).toBe(true);
    for (const invalid of [
      { ...exception, environment: "unknown" },
      { ...exception, issue: "SJ-1" },
      { ...exception, reviewBy: "2026-02-30" },
    ]) {
      expect(
        ManagedFlagInventorySchema.safeParse({
          ...value,
          flags: [{ ...baseline, defaultOffExceptions: [invalid] }],
        }).success,
      ).toBe(false);
    }
    expect(
      ManagedFlagInventorySchema.safeParse({
        ...value,
        flags: [{ ...baseline, defaultOffExceptions: [exception, exception] }],
      }).success,
    ).toBe(false);
    expect(
      ManagedFlagInventorySchema.safeParse({
        ...value,
        flags: [
          { ...baseline, default: true, defaultOffExceptions: [exception] },
        ],
      }).success,
    ).toBe(false);
    expect(
      defaultOnPolicyViolations({
        ...ManagedFlagInventorySchema.parse(value),
        flags: [baseline],
      }),
    ).toHaveLength(1);
  });
});
