import type { ManagedFlag } from "./managed-flag-inventory.ts";

export type OrderedBooleanRollout =
  | {
      readonly kind: "threshold";
      readonly rank: number;
      readonly percentage: number;
      readonly result: boolean;
    }
  | {
      readonly kind: "segment";
      readonly rank: number;
      readonly segmentKey: string;
      readonly segmentOperator: string;
      readonly result: boolean;
    };

export function orderedBooleanRollouts(
  flag: Extract<ManagedFlag, { type: "boolean" }>,
): OrderedBooleanRollout[] {
  const thresholdByRank = new Map(
    flag.thresholdRollouts.map((rollout) => [rollout.rank, rollout]),
  );
  if (thresholdByRank.size !== flag.thresholdRollouts.length) {
    throw new Error(`duplicate threshold rollout rank for ${flag.key}`);
  }

  const total = flag.rollouts.length + thresholdByRank.size;
  for (const rank of thresholdByRank.keys()) {
    if (rank < 1 || rank > total) {
      throw new Error(
        `threshold rollout rank out of range for ${flag.key}: ${rank.toString()}`,
      );
    }
  }

  const ordered: OrderedBooleanRollout[] = [];
  let segmentIndex = 0;
  for (let rank = 1; rank <= total; rank += 1) {
    const threshold = thresholdByRank.get(rank);
    if (threshold !== undefined) {
      ordered.push({
        kind: "threshold",
        rank,
        percentage: threshold.percentage,
        result: threshold.result,
      });
      continue;
    }
    const segment = flag.rollouts[segmentIndex];
    if (segment === undefined) {
      throw new Error(
        `missing segment rollout for ${flag.key} at rank ${rank.toString()}`,
      );
    }
    ordered.push({
      kind: "segment",
      rank,
      segmentKey: segment.segmentKey,
      segmentOperator: segment.segmentOperator,
      result: segment.result,
    });
    segmentIndex += 1;
  }
  return ordered;
}
