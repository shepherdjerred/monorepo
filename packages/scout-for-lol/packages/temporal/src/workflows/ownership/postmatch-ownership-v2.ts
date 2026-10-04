import { ApplicationFailure } from "@temporalio/common";
import { patched } from "@temporalio/workflow";
import type { ScoutPostMatchDiscoveryV2Input } from "#src/workflow-contracts-v2.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { realtimeV2Activities } from "#src/workflows/activity-options.ts";

/**
 * The marker for histories whose discovery asked who owns the pass.
 *
 * The ownership read was an inserted command at the head of
 * `scoutPostMatchDiscoveryV2Workflow`, so an execution recorded before it
 * replays through the gate as `false`. Never rename it: a patch id names one
 * change to this Workflow's command sequence for as long as an execution that
 * recorded it can replay.
 */
export const SCOUT_V2_POSTMATCH_OWNERSHIP_PATCH =
  "scout-v2-postmatch-ownership";

/**
 * The marker for histories recorded after the ownership read was retired.
 *
 * Removing the read is the reverse of the usual patch lifecycle: the code
 * goes BACK to the shape pre-ownership histories recorded, while executions
 * that did record the read can still be open. A bare `deprecatePatch` of the
 * ownership patch would tolerate its marker but schedule discovery where such
 * a history recorded the ownership read, and fail every one of them on
 * replay. Postmatch discovery runs every minute under a `SKIP` overlap policy
 * and awaits its match children, so one wedged that way would stop the
 * Schedule. This second marker tells the generations apart instead.
 *
 * Its id deliberately does not contain the ownership patch's id, so a
 * substring search of a history for one never matches the other.
 *
 * Never rename it. Once no discovery started before it shipped can still be
 * open, the gate below becomes `deprecatePatch` of this id, and a release
 * after that removes it.
 */
export const SCOUT_V2_POSTMATCH_OWNERSHIP_RETIRED_PATCH =
  "scout-v2-retired-postmatch-ownership";

/**
 * Replay the retired post-match ownership read, for the histories that made
 * it, and do nothing for every other run.
 *
 * Three generations reach here:
 *
 * - A run started after the retirement records the retired marker and skips
 *   the read. V2 owns post-match discovery unconditionally.
 * - A run recorded while the ownership read existed replays it. The flag that
 *   answered it was on in every environment, so the recorded answer is
 *   `run-v2` and the run continues into V2 discovery as it did then. If the
 *   read is still pending when this deploys, the backend now answers `run-v2`
 *   too.
 * - A run recorded before the read existed records neither marker and goes
 *   straight to discovery.
 *
 * A recorded `delegate-v1` or `defer-v1` answer means the rollback switch was
 * thrown while this execution ran. Nothing here can replay the v1 handoff
 * that followed, so it fails loudly rather than pretending the pass was V2's.
 */
export async function replayRetiredPostmatchOwnershipRead(
  input: ScoutPostMatchDiscoveryV2Input,
): Promise<void> {
  if (patched(SCOUT_V2_POSTMATCH_OWNERSHIP_RETIRED_PATCH)) return;
  if (!patched(SCOUT_V2_POSTMATCH_OWNERSHIP_PATCH)) return;
  // Part of the recorded sequence, not decoration: this was the run's first
  // phase update, so it is where the UI interceptor's own patch marker sits
  // in these histories, ahead of the ownership read.
  setWorkflowPhase("**Phase:** resolving post-match discovery ownership");
  const owner = await realtimeV2Activities(
    input.stage,
  ).resolvePostMatchDiscoveryOwnerV2(input);
  if (owner.decision === "run-v2") return;
  throw ApplicationFailure.nonRetryable(
    `This post-match discovery recorded a ${owner.decision} ownership answer, and the v1 handoff it led to has been removed`,
    "RetiredPostMatchOwnership",
  );
}
