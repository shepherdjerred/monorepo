import { describe, expect, test } from "vitest";
import {
  classifyFlagBoolean,
  classifyManagedBoolean,
} from "./rollout-state.ts";
import {
  defaultOnPolicyViolations,
  managedFlagInventory,
  ManagedFlagInventorySchema,
} from "./managed-flag-inventory.ts";
import type { ManagedFlag } from "./managed-flag-inventory.ts";
import type { FlagValue } from "./evaluate.ts";
import { FlagsProvider } from "./providers/flags.ts";

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
  test("constant defaults and ordered segment targeting agree with FlagsProvider", async () => {
    const flags: FlagValue[] = [
      {
        type: "boolean",
        key: "constant-off",
        default: false,
        rollouts: [],
      },
      {
        type: "boolean",
        key: "constant-on",
        default: true,
        rollouts: [],
      },
      {
        type: "boolean",
        key: "ordered",
        default: true,
        rollouts: [
          {
            constraints: [{ property: "cohort", value: "pilot" }],
            result: false,
          },
        ],
      },
    ];
    expect(flags.map((flag) => classifyFlagBoolean(flag))).toEqual([
      "off",
      "on",
      "targeted",
    ]);
    const provider = new FlagsProvider({
      url: "http://flags.invalid:7361",
      deployment: "scout/prod",
      pollIntervalSeconds: 300,
      fetcher: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => '"1"' },
          json: () =>
            Promise.resolve({
              deployment: "scout/prod",
              revision: 1,
              flags,
            }),
        }),
    });
    try {
      await provider.initialize();
      for (let index = 0; index < 200; index++) {
        const context = { targetingKey: `entity-${String(index)}` };
        const off = await provider.resolveBooleanEvaluation(
          "constant-off",
          true,
          context,
        );
        const on = await provider.resolveBooleanEvaluation(
          "constant-on",
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
});

describe("classifyFlagBoolean", () => {
  test("classifies first-party FlagValue booleans, segments, missing, and invalid entries", () => {
    expect(classifyFlagBoolean(undefined)).toBe("missing");
    expect(
      classifyFlagBoolean({ type: "variant", key: "test", value: "sol" }),
    ).toBe("invalid");
    expect(
      classifyFlagBoolean({
        type: "boolean",
        key: "test",
        default: false,
        rollouts: [{ constraints: [], result: true }],
      }),
    ).toBe("invalid");
    expect(
      classifyFlagBoolean({
        type: "boolean",
        key: "test",
        default: true,
        rollouts: [
          {
            constraints: [{ property: "stage", value: "beta" }],
            result: true,
          },
        ],
      }),
    ).toBe("on");
    expect(
      classifyFlagBoolean({
        type: "boolean",
        key: "test",
        default: false,
        rollouts: [
          {
            constraints: [{ property: "stage", value: "beta" }],
            result: true,
          },
        ],
      }),
    ).toBe("targeted");
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
    const noConsumerException = {
      environment: "prod",
      reason: "production-only service",
      issue: "AI-2",
      enableWhen: "a consumer is deployed in this environment",
      noDeployedConsumer: true as const,
    };
    expect(
      ManagedFlagInventorySchema.safeParse({
        ...value,
        flags: [{ ...baseline, defaultOffExceptions: [noConsumerException] }],
      }).success,
    ).toBe(true);
    const { reviewBy: _omittedReviewBy, ...missingReviewBy } = exception;
    for (const invalid of [
      { ...exception, environment: "unknown" },
      { ...exception, issue: "SJ-1" },
      { ...exception, reviewBy: "2026-02-30" },
      missingReviewBy,
      { ...missingReviewBy, noDeployedConsumer: false },
      { ...exception, noDeployedConsumer: false },
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
