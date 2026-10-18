import { deprecatePatch } from "@temporalio/workflow";

/**
 * The marker for histories recorded after the post-match ownership read was
 * retired.
 *
 * Every retained discovery history recorded it, so neither the ownership read
 * nor a run from before that read can replay any more, and the gate is
 * deprecated. Its id deliberately does not contain the old ownership patch's
 * id (`scout-v2-postmatch-ownership`), so a substring search of a history for
 * one never matches the other. Never rename it. Remove the `deprecatePatch`
 * call in a release after this one.
 */
export const SCOUT_POSTMATCH_OWNERSHIP_RETIRED_PATCH =
  "scout-v2-retired-postmatch-ownership";

/**
 * Record the retirement marker where the retired gate stood: discovery's first
 * command. A rollback to a bundle that still gates on it then skips the
 * retired ownership read for histories this bundle records.
 */
export function markRetiredPostmatchOwnership(): void {
  deprecatePatch(SCOUT_POSTMATCH_OWNERSHIP_RETIRED_PATCH);
}
