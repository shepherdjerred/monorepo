import { z } from "zod";
import type { ManagedFlag } from "./managed-flag-inventory.ts";

export const FLIPT_FLAG_TYPE_URL = "flipt.core.Flag";
export const FLIPT_SEGMENT_TYPE_URL = "flipt.core.Segment";

const AttachmentSchema = z.record(z.string(), z.unknown());

export type FliptSegmentPayload = {
  readonly "@type": typeof FLIPT_SEGMENT_TYPE_URL;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly matchType: string;
  readonly constraints: readonly {
    readonly type: string;
    readonly property: string;
    readonly operator: string;
    readonly value: string;
    readonly description: string;
  }[];
};

export type FliptFlagPayload = {
  readonly "@type": typeof FLIPT_FLAG_TYPE_URL;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly type: "BOOLEAN_FLAG_TYPE" | "VARIANT_FLAG_TYPE";
  readonly variants: readonly {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly attachment: Readonly<Record<string, unknown>>;
  }[];
  readonly rules: readonly {
    readonly rank: number;
    readonly segmentOperator: string;
    readonly segments: readonly string[];
    readonly distributions: readonly {
      readonly variant: string;
      readonly rollout: number;
    }[];
  }[];
  readonly rollouts: readonly FliptRolloutPayload[];
  readonly defaultVariant?: string;
  readonly metadata: {
    readonly owner: string;
    readonly source: string;
    readonly namespace: string;
  };
};

export type FliptRolloutPayload =
  | {
      readonly type: "SEGMENT_ROLLOUT_TYPE";
      readonly description: string;
      readonly segment: {
        readonly value: boolean;
        readonly segments: readonly string[];
        readonly segmentOperator: string;
      };
    }
  | {
      readonly type: "THRESHOLD_ROLLOUT_TYPE";
      readonly description: string;
      readonly threshold: {
        readonly percentage: number;
        readonly value: boolean;
      };
    };

function fliptComparisonType(type: string): string {
  if (!type.includes("_CONSTRAINT_")) {
    throw new Error(`unsupported Flipt snapshot constraint type: ${type}`);
  }
  return type.replace("_CONSTRAINT_", "_");
}

function fliptMatchType(type: string): string {
  if (!type.includes("_SEGMENT_")) {
    throw new Error(`unsupported Flipt snapshot match type: ${type}`);
  }
  return type.replace("_SEGMENT_", "_");
}

function parseAttachment(
  attachment: string,
  variantKey: string,
): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(attachment);
    if (value === null) return {};
    return AttachmentSchema.parse(value);
  } catch (error) {
    throw new Error(`invalid attachment JSON for variant ${variantKey}`, {
      cause: error,
    });
  }
}

function segmentPayload(input: {
  readonly key: string;
  readonly matchType: string;
  readonly constraints: ManagedFlag["rollouts"][number]["constraints"];
}): FliptSegmentPayload {
  return {
    "@type": FLIPT_SEGMENT_TYPE_URL,
    key: input.key,
    name: input.key,
    description: `Managed segment ${input.key}.`,
    matchType: fliptMatchType(input.matchType),
    constraints: input.constraints.map((constraint) => ({
      type: fliptComparisonType(constraint.type),
      property: constraint.property,
      operator: constraint.operator,
      value: constraint.value,
      description: `Match ${constraint.property}.`,
    })),
  };
}

function flagSegments(flag: ManagedFlag): FliptSegmentPayload[] {
  return [
    ...flag.rollouts.map((rollout) =>
      segmentPayload({
        key: rollout.segmentKey,
        matchType: rollout.matchType,
        constraints: rollout.constraints,
      }),
    ),
    ...flag.rules.flatMap((rule) =>
      rule.segments.map((segment) =>
        segmentPayload({
          key: segment.key,
          matchType: segment.matchType,
          constraints: segment.constraints,
        }),
      ),
    ),
  ];
}

export function collectManagedSegmentPayloads(
  flags: readonly ManagedFlag[],
): FliptSegmentPayload[] {
  const definitions = new Map<string, FliptSegmentPayload>();
  for (const flag of flags) {
    for (const payload of flagSegments(flag)) {
      const existing = definitions.get(payload.key);
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(payload)
      ) {
        throw new Error(
          `conflicting managed segment definition: ${payload.key}`,
        );
      }
      definitions.set(payload.key, payload);
    }
  }
  return [...definitions.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function booleanRollouts(
  flag: Extract<ManagedFlag, { type: "boolean" }>,
): FliptRolloutPayload[] {
  const thresholdByRank = new Map(
    flag.thresholdRollouts.map((rollout) => [rollout.rank, rollout]),
  );
  if (thresholdByRank.size !== flag.thresholdRollouts.length) {
    throw new Error(`duplicate threshold rollout rank for ${flag.key}`);
  }

  const segmentRollouts = flag.rollouts.map((rollout) => ({
    type: "SEGMENT_ROLLOUT_TYPE" as const,
    description: `Managed segment rollout for ${rollout.segmentKey}.`,
    segment: {
      value: rollout.result,
      segments: [rollout.segmentKey],
      segmentOperator: rollout.segmentOperator,
    },
  }));
  const total = segmentRollouts.length + thresholdByRank.size;
  for (const rank of thresholdByRank.keys()) {
    if (rank < 1 || rank > total) {
      throw new Error(
        `threshold rollout rank out of range for ${flag.key}: ${rank.toString()}`,
      );
    }
  }

  const rendered: FliptRolloutPayload[] = [];
  let segmentIndex = 0;
  for (let rank = 1; rank <= total; rank += 1) {
    const threshold = thresholdByRank.get(rank);
    if (threshold !== undefined) {
      rendered.push({
        type: "THRESHOLD_ROLLOUT_TYPE",
        description: `Managed threshold rollout at rank ${rank.toString()}.`,
        threshold: {
          percentage: threshold.percentage,
          value: threshold.result,
        },
      });
      continue;
    }
    const segment = segmentRollouts[segmentIndex];
    if (segment === undefined) {
      throw new Error(
        `missing segment rollout for ${flag.key} at rank ${rank.toString()}`,
      );
    }
    rendered.push(segment);
    segmentIndex += 1;
  }
  return rendered;
}

function variantDefinitions(flag: Extract<ManagedFlag, { type: "variant" }>) {
  const attachments = new Map<string, string>();
  for (const rule of flag.rules) {
    for (const distribution of rule.distributions) {
      const existing = attachments.get(distribution.variantKey);
      if (
        existing !== undefined &&
        existing !== distribution.variantAttachment
      ) {
        throw new Error(
          `conflicting variant attachment: ${flag.key}/${distribution.variantKey}`,
        );
      }
      attachments.set(distribution.variantKey, distribution.variantAttachment);
    }
  }

  const keys = new Set<string>([flag.default, ...attachments.keys()]);
  return [...keys]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({
      key,
      name: key,
      description: "",
      attachment: parseAttachment(attachments.get(key) ?? "{}", key),
    }));
}

function variantRules(flag: ManagedFlag) {
  const ranks = new Set<number>();
  const ordered = [...flag.rules].sort((left, right) => left.rank - right.rank);
  return ordered.map((rule, index) => {
    const expectedRank = index + 1;
    if (ranks.has(rule.rank)) {
      throw new Error(
        `duplicate rule rank for ${flag.key}: ${rule.rank.toString()}`,
      );
    }
    ranks.add(rule.rank);
    if (rule.rank !== expectedRank) {
      throw new Error(
        `variant rule rank must be contiguous and one-based for ${flag.key}: expected ${expectedRank.toString()}, got ${rule.rank.toString()}`,
      );
    }
    return {
      rank: rule.rank,
      segmentOperator: rule.segmentOperator,
      segments: rule.segments.map((segment) => segment.key),
      distributions: rule.distributions.map((distribution) => ({
        variant: distribution.variantKey,
        rollout: distribution.rollout,
      })),
    };
  });
}

export function toFliptFlagPayload(flag: ManagedFlag): FliptFlagPayload {
  const metadata = {
    owner: flag.owner,
    source: flag.source,
    namespace: flag.namespace,
  };
  if (flag.type === "boolean") {
    return {
      "@type": FLIPT_FLAG_TYPE_URL,
      key: flag.key,
      name: flag.key,
      description: flag.purpose,
      enabled: flag.default,
      type: "BOOLEAN_FLAG_TYPE",
      variants: [],
      rules: [],
      rollouts: booleanRollouts(flag),
      metadata,
    };
  }
  return {
    "@type": FLIPT_FLAG_TYPE_URL,
    key: flag.key,
    name: flag.key,
    description: flag.purpose,
    enabled: true,
    type: "VARIANT_FLAG_TYPE",
    variants: variantDefinitions(flag),
    rules: variantRules(flag),
    rollouts: [],
    defaultVariant: flag.default,
    metadata,
  };
}
