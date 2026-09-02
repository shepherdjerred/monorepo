import YAML from "yaml";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlag,
  type ManagedFlagInventory,
  type ManagedNamespace,
} from "./managed-flag-inventory.ts";

type DeclarativeSegment = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly constraints: readonly {
    readonly type: string;
    readonly property: string;
    readonly operator: string;
    readonly value: string;
    readonly description: string;
  }[];
  readonly match_type: string;
};

function declarativeConstraintType(type: string): string {
  if (!type.includes("_CONSTRAINT_")) {
    throw new Error(`unsupported Flipt snapshot constraint type: ${type}`);
  }
  return type.replace("_CONSTRAINT_", "_");
}

function declarativeMatchType(type: string): string {
  if (!type.includes("_SEGMENT_")) {
    throw new Error(`unsupported Flipt snapshot match type: ${type}`);
  }
  return type.replace("_SEGMENT_", "_");
}

function segmentDefinition(input: {
  readonly key: string;
  readonly matchType: string;
  readonly constraints: ManagedFlag["rollouts"][number]["constraints"];
}): DeclarativeSegment {
  return {
    key: input.key,
    name: input.key,
    description: `Managed segment ${input.key}.`,
    constraints: input.constraints.map((constraint) => ({
      type: declarativeConstraintType(constraint.type),
      property: constraint.property,
      operator: constraint.operator,
      value: constraint.value,
      description: `Match ${constraint.property}.`,
    })),
    match_type: declarativeMatchType(input.matchType),
  };
}

function collectSegments(flags: readonly ManagedFlag[]): DeclarativeSegment[] {
  const definitions = new Map<string, DeclarativeSegment>();
  const addDefinition = (definition: DeclarativeSegment): void => {
    const existing = definitions.get(definition.key);
    if (
      existing !== undefined &&
      JSON.stringify(existing) !== JSON.stringify(definition)
    ) {
      throw new Error(
        `conflicting managed segment definition: ${definition.key}`,
      );
    }
    definitions.set(definition.key, definition);
  };

  for (const flag of flags) {
    for (const rollout of flag.rollouts) {
      addDefinition(
        segmentDefinition({
          key: rollout.segmentKey,
          matchType: rollout.matchType,
          constraints: rollout.constraints,
        }),
      );
    }
    for (const rule of flag.rules) {
      for (const segment of rule.segments) {
        addDefinition(
          segmentDefinition({
            key: segment.key,
            matchType: segment.matchType,
            constraints: segment.constraints,
          }),
        );
      }
    }
  }

  return [...definitions.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function parseAttachment(attachment: string, variantKey: string): unknown {
  try {
    const value: unknown = JSON.parse(attachment);
    return value;
  } catch (error) {
    throw new Error(`invalid attachment JSON for variant ${variantKey}`, {
      cause: error,
    });
  }
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
      default: key === flag.default,
      key,
      name: key,
      attachment: parseAttachment(attachments.get(key) ?? "{}", key),
    }));
}

function declarativeRules(flag: ManagedFlag) {
  const ranks = new Set<number>();
  return [...flag.rules]
    .sort((left, right) => left.rank - right.rank)
    .map((rule) => {
      if (ranks.has(rule.rank)) {
        throw new Error(
          `duplicate rule rank for ${flag.key}: ${rule.rank.toString()}`,
        );
      }
      ranks.add(rule.rank);
      return {
        segment: {
          keys: rule.segments.map((segment) => segment.key),
          operator: rule.segmentOperator,
        },
        rank: rule.rank,
        distributions: rule.distributions.map((distribution) => ({
          variant: distribution.variantKey,
          rollout: distribution.rollout,
        })),
      };
    });
}

function declarativeBooleanRollouts(
  flag: Extract<ManagedFlag, { type: "boolean" }>,
) {
  const thresholdByRank = new Map(
    flag.thresholdRollouts.map((rollout) => [rollout.rank, rollout]),
  );
  if (thresholdByRank.size !== flag.thresholdRollouts.length) {
    throw new Error(`duplicate threshold rollout rank for ${flag.key}`);
  }

  const segmentRollouts = flag.rollouts.map((rollout) => ({
    description: `Managed segment rollout for ${rollout.segmentKey}.`,
    segment: {
      keys: [rollout.segmentKey],
      operator: rollout.segmentOperator,
      value: rollout.result,
    },
  }));
  const total = segmentRollouts.length + thresholdByRank.size;
  for (const rank of thresholdByRank.keys()) {
    if (rank >= total) {
      throw new Error(
        `threshold rollout rank out of range for ${flag.key}: ${rank.toString()}`,
      );
    }
  }

  const rendered = [];
  let segmentIndex = 0;
  for (let rank = 0; rank < total; rank += 1) {
    const threshold = thresholdByRank.get(rank);
    if (threshold !== undefined) {
      rendered.push({
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

function declarativeFlag(flag: ManagedFlag) {
  const common = {
    key: flag.key,
    name: flag.key,
    description: flag.purpose,
    enabled: flag.type === "boolean" ? flag.default : true,
    metadata: {
      owner: flag.owner,
      source: flag.source,
      namespace: flag.namespace,
    },
  };
  if (flag.type === "boolean") {
    return {
      ...common,
      type: "BOOLEAN_FLAG_TYPE",
      rollouts: declarativeBooleanRollouts(flag),
    };
  }
  return {
    ...common,
    type: "VARIANT_FLAG_TYPE",
    variants: variantDefinitions(flag),
    rules: declarativeRules(flag),
  };
}

function findNamespace(
  inventory: ManagedFlagInventory,
  namespaceKey: string,
): ManagedNamespace {
  const namespace = inventory.namespaces.find(
    (candidate) => candidate.key === namespaceKey,
  );
  if (namespace === undefined)
    throw new Error(`unknown managed namespace: ${namespaceKey}`);
  return namespace;
}

export function renderFliptFeatures(
  environmentKey: string,
  namespaceKey: string,
  inventory: ManagedFlagInventory = managedFlagInventory,
): string {
  const namespace = findNamespace(inventory, namespaceKey);
  const flags = materializeManagedNamespaceEnvironment(
    inventory,
    environmentKey,
    namespaceKey,
  );
  return YAML.stringify({
    version: "1.6",
    namespace: {
      key: namespace.key,
      name: namespace.name,
      description: namespace.description,
    },
    flags: flags.map((flag) => declarativeFlag(flag)),
    segments: collectSegments(flags),
  });
}
