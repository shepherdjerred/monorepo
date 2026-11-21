import {
  flagDeploymentForSelector,
  flagDeployments,
  type FlagDeployment,
} from "./deployments.ts";
import type { FlagValue, SegmentRollout } from "./evaluate.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlag,
} from "./managed-flag-inventory.ts";

const STRING_EQUALITY = "STRING_CONSTRAINT_COMPARISON_TYPE";
const ALL_MATCH = "ALL_SEGMENT_MATCH_TYPE";

function projectRollout(
  flagKey: string,
  rollout: ManagedFlag["rollouts"][number],
): SegmentRollout {
  if (rollout.matchType !== ALL_MATCH) {
    throw new Error(
      `${flagKey} uses match type ${rollout.matchType}, which the evaluator does not implement`,
    );
  }
  return {
    result: rollout.result,
    constraints: rollout.constraints.map((constraint) => {
      if (constraint.type !== STRING_EQUALITY || constraint.operator !== "eq") {
        throw new Error(
          `${flagKey} uses constraint ${constraint.type}/${constraint.operator}, which the evaluator does not implement`,
        );
      }
      return { property: constraint.property, value: constraint.value };
    }),
  };
}

function projectFlag(flag: ManagedFlag): FlagValue {
  if (flag.rules.length > 0 || flag.thresholdRollouts.length > 0) {
    throw new Error(
      `${flag.key} uses variant rules or a percentage rollout, which the evaluator does not implement`,
    );
  }
  if (flag.type === "variant") {
    return { type: "variant", key: flag.key, value: flag.default };
  }
  return {
    type: "boolean",
    key: flag.key,
    default: flag.default,
    rollouts: flag.rollouts.map((rollout) => projectRollout(flag.key, rollout)),
  };
}

/** The flag document a deployment reads, projected from the managed inventory. */
export function projectDeploymentFlags(
  deployment: FlagDeployment,
): FlagValue[] {
  return materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    deployment.fliptEnvironment,
    deployment.catalog,
  ).map((flag) => projectFlag(flag));
}

export function projectDeploymentById(id: string): FlagValue[] {
  const deployment = flagDeployments.find((candidate) => candidate.id === id);
  if (deployment === undefined) {
    throw new Error(`unknown flag deployment: ${id}`);
  }
  return projectDeploymentFlags(deployment);
}

export function deploymentForCatalog(
  catalog: string,
  fliptEnvironment: string,
): FlagDeployment {
  const deployment = flagDeploymentForSelector(catalog, fliptEnvironment);
  if (deployment === undefined) {
    throw new Error(
      `no flag deployment reads ${catalog} in Flipt environment ${fliptEnvironment}`,
    );
  }
  return deployment;
}
