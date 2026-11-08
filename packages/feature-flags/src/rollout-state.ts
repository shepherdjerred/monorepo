import type { SnapshotFlag } from "./managed-flag-drift.ts";
import type { ManagedFlag } from "./managed-flag-inventory.ts";
import { orderedBooleanRollouts } from "./flipt-boolean-rollouts.ts";

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

export function classifySnapshotBoolean(
  flag: SnapshotFlag | undefined,
): FlagRolloutState {
  if (flag === undefined) return "missing";
  if (flag.type !== "BOOLEAN_FLAG_TYPE" || flag.rules.length > 0)
    return "invalid";
  const ordered = flag.rollouts.toSorted((a, b) => a.rank - b.rank);
  if (
    new Set(ordered.map((r) => r.rank)).size !== ordered.length ||
    ordered.some((r) => r.rank < 1)
  )
    return "invalid";
  return classify(
    flag.enabled,
    ordered.map((r): BooleanRollout =>
      r.type === "THRESHOLD_ROLLOUT_TYPE"
        ? {
            kind: "threshold",
            result: r.threshold.value,
            percentage: r.threshold.percentage,
          }
        : { kind: "segment", result: r.segment.value },
    ),
  );
}
