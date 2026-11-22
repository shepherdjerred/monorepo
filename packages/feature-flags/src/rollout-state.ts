import type { FlagValue } from "./evaluate.ts";
import type { ManagedFlag } from "./managed-flag-inventory.ts";

export const FLAG_ROLLOUT_STATES = [
  "on",
  "off",
  "targeted",
  "partial",
  "missing",
  "invalid",
] as const;
export type FlagRolloutState = (typeof FLAG_ROLLOUT_STATES)[number];

type BooleanRollout =
  | { readonly kind: "segment"; readonly result: boolean }
  | {
      readonly kind: "threshold";
      readonly result: boolean;
      readonly percentage: number;
    };

function orderedBooleanRollouts(
  flag: Extract<ManagedFlag, { type: "boolean" }>,
): BooleanRollout[] {
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

  const ordered: BooleanRollout[] = [];
  let segmentIndex = 0;
  for (let rank = 1; rank <= total; rank += 1) {
    const threshold = thresholdByRank.get(rank);
    if (threshold !== undefined) {
      ordered.push({
        kind: "threshold",
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
      result: segment.result,
    });
    segmentIndex += 1;
  }
  return ordered;
}

/** Prove constant outcomes; conditional segments are conservatively allowed to match. */
function classify(
  defaultValue: boolean,
  rollouts: readonly BooleanRollout[],
): FlagRolloutState {
  const outcomes = new Set<boolean>();
  let terminal = false;
  let partial = false;
  for (const rollout of rollouts) {
    if (rollout.kind === "threshold") {
      if (rollout.percentage === 0) continue;
      outcomes.add(rollout.result);
      if (rollout.percentage === 100) {
        terminal = true;
        break;
      }
      partial = true;
    } else {
      outcomes.add(rollout.result);
    }
  }
  if (!terminal) outcomes.add(defaultValue);
  if (outcomes.size === 1) return outcomes.has(true) ? "on" : "off";
  return partial ? "partial" : "targeted";
}

export function classifyManagedBoolean(
  flag: Extract<ManagedFlag, { type: "boolean" }>,
): FlagRolloutState {
  return flag.rules.length > 0
    ? "invalid"
    : classify(flag.default, orderedBooleanRollouts(flag));
}

export function classifyFlagBoolean(
  flag: FlagValue | undefined,
): FlagRolloutState {
  if (flag === undefined) return "missing";
  if (
    flag.type !== "boolean" ||
    flag.rollouts.some((rollout) => rollout.constraints.length === 0)
  ) {
    return "invalid";
  }
  return classify(
    flag.default,
    flag.rollouts.map((rollout): BooleanRollout => ({
      kind: "segment",
      result: rollout.result,
    })),
  );
}
