import {
  isFeatureHardDisabled,
  type FlagName,
} from "#src/configuration/flags.ts";

/**
 * Which feature flag, if any, can switch a Temporal workload off entirely.
 *
 * A hard disable is not a pause: the Activity returns having done nothing, so
 * the Workflow completes and its Schedule moves on rather than accumulating a
 * backlog to replay when the flag comes back. Only workloads whose product is
 * genuinely optional appear here; everything else returns `null` and runs.
 *
 * This lives apart from the activity factories because two of them consult it —
 * the realtime group and the background group — and the factories are separate
 * modules. A helper that lived in one of them would make the other import a
 * module whose whole purpose is to build a different queue's Activities.
 */
export function hardDisabledFeatureForTemporalWork(
  kind: string,
): FlagName | null {
  switch (kind) {
    case "custom-nights-expiry":
      return "custom_nights_enabled";
    case "bucks-reconciliation":
    case "weekly-bucks-leaderboard":
      return "betting_enabled";
    default:
      return null;
  }
}

export function temporalWorkHardDisabled(kind: string): boolean {
  const feature = hardDisabledFeatureForTemporalWork(kind);
  return feature !== null && isFeatureHardDisabled(feature);
}
