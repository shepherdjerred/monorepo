import { z } from "zod";
import {
  managedFlagInventory,
  type ManagedFlag,
} from "./managed-flag-inventory.ts";

const SegmentConstraintSchema = z.object({
  type: z.string().min(1),
  property: z.string().min(1),
  operator: z.string().min(1),
  value: z.string(),
});

const SegmentSchema = z.object({
  key: z.string().min(1),
  matchType: z.string().min(1),
  constraints: z.array(SegmentConstraintSchema),
});

const SegmentRolloutSchema = z.object({
  type: z.literal("SEGMENT_ROLLOUT_TYPE"),
  rank: z.number().int().nonnegative(),
  segment: z.object({
    value: z.boolean(),
    segmentOperator: z.string().min(1),
    segments: z.array(SegmentSchema),
  }),
});

const ThresholdRolloutSchema = z.object({
  type: z.literal("THRESHOLD_ROLLOUT_TYPE"),
  rank: z.number().int().nonnegative(),
  threshold: z.object({
    percentage: z.number().min(0).max(100),
    value: z.boolean(),
  }),
});

const DistributionSchema = z.object({
  variantKey: z.string().min(1),
  variantAttachment: z.string(),
  rollout: z.number().min(0).max(100),
});

const RuleSchema = z.object({
  rank: z.number().int().nonnegative(),
  segmentOperator: z.string().min(1),
  segments: z.array(SegmentSchema),
  distributions: z.array(DistributionSchema),
});

const SnapshotFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  type: z.enum(["BOOLEAN_FLAG_TYPE", "VARIANT_FLAG_TYPE"]),
  rules: z.array(RuleSchema),
  rollouts: z.array(z.union([SegmentRolloutSchema, ThresholdRolloutSchema])),
  defaultVariant: z.object({ key: z.string() }).optional(),
});

export const FliptSnapshotSchema = z.object({
  flags: z.array(SnapshotFlagSchema),
});

export type FliptSnapshot = z.infer<typeof FliptSnapshotSchema>;
export type SnapshotFlag = z.infer<typeof SnapshotFlagSchema>;

export type ManagedFlagDrift = {
  readonly missingInFlipt: readonly string[];
  readonly undeclaredInInventory: readonly string[];
  readonly contractMismatches: readonly string[];
};

export type FliptFetcher = (
  input: string | Request | URL,
  init?: RequestInit,
) => Promise<Response>;

export type FetchFliptSnapshotOptions = {
  readonly url: string;
  readonly namespace?: string;
  readonly environment: string;
  readonly fetcher?: FliptFetcher;
};

function normalizeConstraint(
  constraint: z.infer<typeof SegmentConstraintSchema>,
): ManagedFlag["rollouts"][number]["constraints"][number] {
  return {
    type: constraint.type,
    property: constraint.property,
    operator: constraint.operator,
    value: constraint.value,
  };
}

function normalizeSegments(
  segments: z.infer<typeof SegmentSchema>[],
): ManagedFlag["rules"][number]["segments"] {
  return segments.map((segment) => ({
    key: segment.key,
    matchType: segment.matchType,
    constraints: segment.constraints.map((constraint) =>
      normalizeConstraint(constraint),
    ),
  }));
}

function normalizeRollouts(
  rollouts: SnapshotFlag["rollouts"],
): ManagedFlag["rollouts"] {
  return rollouts.flatMap((rollout) => {
    if (rollout.type !== "SEGMENT_ROLLOUT_TYPE") return [];
    return rollout.segment.segments.map((segment) => ({
      segmentKey: segment.key,
      segmentOperator: rollout.segment.segmentOperator,
      matchType: segment.matchType,
      constraints: segment.constraints.map((constraint) =>
        normalizeConstraint(constraint),
      ),
      result: rollout.segment.value,
    }));
  });
}

function normalizeThresholdRollouts(
  rollouts: SnapshotFlag["rollouts"],
): ManagedFlag["thresholdRollouts"] {
  return rollouts.flatMap((rollout) => {
    if (rollout.type !== "THRESHOLD_ROLLOUT_TYPE") return [];
    return [
      {
        rank: rollout.rank,
        percentage: rollout.threshold.percentage,
        result: rollout.threshold.value,
      },
    ];
  });
}

function normalizeRules(rules: SnapshotFlag["rules"]): ManagedFlag["rules"] {
  return rules.map((rule) => ({
    rank: rule.rank,
    segmentOperator: rule.segmentOperator,
    segments: normalizeSegments(rule.segments),
    distributions: rule.distributions.map((distribution) => ({
      variantKey: distribution.variantKey,
      rollout: distribution.rollout,
      variantAttachment: distribution.variantAttachment,
    })),
  }));
}

function contractErrors(expected: ManagedFlag, actual: SnapshotFlag): string[] {
  const actualType =
    actual.type === "BOOLEAN_FLAG_TYPE" ? "boolean" : "variant";
  if (actualType !== expected.type) {
    return [
      `${expected.key}: expected type ${expected.type}, got ${actualType}`,
    ];
  }

  const actualDefault =
    expected.type === "boolean" ? actual.enabled : actual.defaultVariant?.key;
  const errors: string[] = [];
  if (actualDefault !== expected.default) {
    errors.push(
      `${expected.key}: expected default ${JSON.stringify(expected.default)}, got ${JSON.stringify(actualDefault)}`,
    );
  }
  const actualRollouts = normalizeRollouts(actual.rollouts);
  if (JSON.stringify(actualRollouts) !== JSON.stringify(expected.rollouts)) {
    errors.push(
      `${expected.key}: rollout contract mismatch; expected ${JSON.stringify(expected.rollouts)}, got ${JSON.stringify(actualRollouts)}`,
    );
  }
  const actualThresholdRollouts = normalizeThresholdRollouts(actual.rollouts);
  if (
    JSON.stringify(actualThresholdRollouts) !==
    JSON.stringify(expected.thresholdRollouts)
  ) {
    errors.push(
      `${expected.key}: threshold rollout mismatch; expected ${JSON.stringify(expected.thresholdRollouts)}, got ${JSON.stringify(actualThresholdRollouts)}`,
    );
  }
  const actualRules = normalizeRules(actual.rules);
  if (JSON.stringify(actualRules) !== JSON.stringify(expected.rules)) {
    errors.push(
      `${expected.key}: variant rule mismatch; expected ${JSON.stringify(expected.rules)}, got ${JSON.stringify(actualRules)}`,
    );
  }
  return errors;
}

export function compareManagedFlagInventory(
  snapshot: FliptSnapshot,
  expectedFlags: readonly ManagedFlag[] = managedFlagInventory.flags,
): ManagedFlagDrift {
  const expectedByKey = new Map(expectedFlags.map((flag) => [flag.key, flag]));
  const actualByKey = new Map(snapshot.flags.map((flag) => [flag.key, flag]));
  const expectedKeys = [...expectedByKey.keys()].sort();
  const actualKeys = [...actualByKey.keys()].sort();

  return {
    missingInFlipt: expectedKeys.filter((key) => !actualByKey.has(key)),
    undeclaredInInventory: actualKeys.filter((key) => !expectedByKey.has(key)),
    contractMismatches: expectedFlags.flatMap((expected) => {
      const actual = actualByKey.get(expected.key);
      return actual === undefined ? [] : contractErrors(expected, actual);
    }),
  };
}

export function formatManagedFlagDrift(drift: ManagedFlagDrift): string[] {
  return [
    ...(drift.missingInFlipt.length === 0
      ? []
      : [
          `declared keys missing from Flipt: ${drift.missingInFlipt.join(",")}`,
        ]),
    ...(drift.undeclaredInInventory.length === 0
      ? []
      : [
          `Flipt keys absent from the inventory: ${drift.undeclaredInInventory.join(",")}`,
        ]),
    ...drift.contractMismatches,
  ];
}

export async function fetchFliptSnapshot(
  options: FetchFliptSnapshotOptions,
): Promise<FliptSnapshot> {
  const namespace = options.namespace ?? managedFlagInventory.namespace;
  const environment = options.environment;
  const url = `${options.url.replace(/\/$/u, "")}/internal/v1/evaluation/snapshot/namespace/${encodeURIComponent(namespace)}`;
  const fetcher: FliptFetcher =
    options.fetcher ?? ((input, init) => fetch(input, init));
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
      "x-flipt-accept-server-version": "1.47.0",
      "x-flipt-environment": environment,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Flipt snapshot request failed: ${response.status.toString()} ${response.statusText}`,
    );
  }
  return FliptSnapshotSchema.parse(await response.json());
}
