import YAML from "yaml";
import { orderedBooleanRollouts } from "./flipt-boolean-rollouts.ts";
import { variantDefinitions as managedVariantDefinitions } from "./flipt-resource-payloads.ts";
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

function variantDefinitions(flag: Extract<ManagedFlag, { type: "variant" }>) {
  return managedVariantDefinitions(flag).map((variant) => ({
    default: variant.key === flag.default,
    key: variant.key,
    name: variant.name,
    attachment: variant.attachment,
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
  return orderedBooleanRollouts(flag).map((slot) => {
    if (slot.kind === "threshold") {
      return {
        description: `Managed threshold rollout at rank ${slot.rank.toString()}.`,
        threshold: {
          percentage: slot.percentage,
          value: slot.result,
        },
      };
    }
    return {
      description: `Managed segment rollout for ${slot.segmentKey}.`,
      segment: {
        keys: [slot.segmentKey],
        operator: slot.segmentOperator,
        value: slot.result,
      },
    };
  });
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
