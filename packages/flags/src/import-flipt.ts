import {
  flagDeployments,
  type FlagDeployment,
} from "@shepherdjerred/feature-flags/deployments.ts";
import type {
  FlagValue,
  SegmentRollout,
} from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  fetchFliptSnapshot,
  type FliptFetcher,
  type FliptSnapshot,
  type SnapshotFlag,
} from "@shepherdjerred/feature-flags/managed-flag-drift.ts";

const OR_ONE_SEGMENT = "OR_SEGMENT_OPERATOR";
const ALL_MATCH = "ALL_SEGMENT_MATCH_TYPE";
const STRING_EQUALITY = "STRING_CONSTRAINT_COMPARISON_TYPE";

type SegmentRolloutFlag = Extract<
  SnapshotFlag["rollouts"][number],
  { type: "SEGMENT_ROLLOUT_TYPE" }
>;

function projectSegment(
  flagKey: string,
  rollout: SegmentRolloutFlag,
): SegmentRollout {
  const only =
    rollout.segment.segments.length === 1
      ? rollout.segment.segments[0]
      : undefined;
  if (
    only === undefined ||
    rollout.segment.segmentOperator !== OR_ONE_SEGMENT
  ) {
    throw new Error(
      `${flagKey} uses segment operator ${rollout.segment.segmentOperator} with ${String(rollout.segment.segments.length)} segments, which the evaluator does not implement`,
    );
  }
  if (only.matchType !== ALL_MATCH) {
    throw new Error(
      `${flagKey} uses match type ${only.matchType}, which the evaluator does not implement`,
    );
  }
  if (only.constraints.length === 0) {
    throw new Error(`${flagKey} segment rollout has no constraints`);
  }
  return {
    result: rollout.segment.value,
    constraints: only.constraints.map((constraint) => {
      if (constraint.type !== STRING_EQUALITY || constraint.operator !== "eq") {
        throw new Error(
          `${flagKey} uses constraint ${constraint.type}/${constraint.operator}, which the evaluator does not implement`,
        );
      }
      return { property: constraint.property, value: constraint.value };
    }),
  };
}

function projectSnapshotFlag(flag: SnapshotFlag): FlagValue {
  if (flag.rules.length > 0) {
    throw new Error(
      `${flag.key} uses variant rules, which the evaluator does not implement`,
    );
  }
  const threshold = flag.rollouts.find(
    (rollout) => rollout.type === "THRESHOLD_ROLLOUT_TYPE",
  );
  if (threshold !== undefined) {
    throw new Error(
      `${flag.key} uses a percentage rollout, which the evaluator does not implement`,
    );
  }
  if (flag.type === "VARIANT_FLAG_TYPE") {
    const value = flag.defaultVariant?.key;
    if (value === undefined) {
      throw new Error(`${flag.key} variant has no default`);
    }
    return { type: "variant", key: flag.key, value };
  }
  return {
    type: "boolean",
    key: flag.key,
    default: flag.enabled,
    rollouts: flag.rollouts
      .flatMap((rollout) =>
        rollout.type === "SEGMENT_ROLLOUT_TYPE" ? [rollout] : [],
      )
      .toSorted((left, right) => left.rank - right.rank)
      .map((rollout) => projectSegment(flag.key, rollout)),
  };
}

/** The flag document a Flipt snapshot actually contains. Unsupported constructs throw. */
export function projectSnapshotDocument(snapshot: FliptSnapshot): FlagValue[] {
  const flags = snapshot.flags.map((flag) => projectSnapshotFlag(flag));
  const seen = new Set<string>();
  for (const flag of flags) {
    if (seen.has(flag.key)) {
      throw new Error(`duplicate flag key: ${flag.key}`);
    }
    seen.add(flag.key);
  }
  return flags;
}

/**
 * The document each deployment's pods read. Fetches every snapshot before
 * returning, so a failure writes nothing.
 */
export async function importDeploymentDocuments(
  url: string,
  fetcher?: FliptFetcher,
  deployments: readonly FlagDeployment[] = flagDeployments,
): Promise<readonly { id: string; flags: FlagValue[] }[]> {
  const documents: { id: string; flags: FlagValue[] }[] = [];
  for (const deployment of deployments) {
    const snapshot = await fetchFliptSnapshot({
      url,
      namespace: deployment.catalog,
      environment: deployment.fliptEnvironment,
      ...(fetcher === undefined ? {} : { fetcher }),
    });
    documents.push({
      id: deployment.id,
      flags: projectSnapshotDocument(snapshot),
    });
  }
  return documents;
}
