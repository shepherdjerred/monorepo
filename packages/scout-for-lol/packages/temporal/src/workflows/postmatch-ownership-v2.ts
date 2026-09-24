import { executeChild, patched, workflowInfo } from "@temporalio/workflow";
import {
  scoutPostMatchDiscoveryV2ResultCodec,
  type ScoutPostMatchDiscoveryV2Input,
  type ScoutPostMatchDiscoveryV2ResultEnvelope,
} from "#src/workflow-contracts-v2.ts";
import { SCOUT_WORKFLOW_NAMES, scoutTaskQueues } from "#src/identifiers.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import { realtimeV2Activities } from "./activity-options.ts";
import { scoutPostMatchDiscoveryWorkflow } from "./realtime.ts";

/**
 * The marker for histories whose discovery asked who owns the pass.
 *
 * The ownership read is an inserted command at the head of the Workflow, so
 * an execution recorded before it replays through the gate as `false` and
 * goes straight to V2 discovery, which is exactly what that generation did.
 * Never rename it: a patch id names one change to this Workflow's command
 * sequence for as long as an execution that recorded it can replay.
 */
export const SCOUT_V2_POSTMATCH_OWNERSHIP_PATCH =
  "scout-v2-postmatch-ownership";

/** The v1 child's ID, derived from this run so two runs can never collide. */
export function legacyPostMatchDiscoveryWorkflowId(parentId: string): string {
  return `${parentId}-legacy-v1`;
}

/**
 * Decide who owns this post-match discovery pass, and run v1 when it does.
 *
 * Returns `null` when V2 owns the pass and the caller continues into V2
 * discovery. Otherwise returns this run's finished result.
 *
 * The Schedule always starts the V2 Workflow Type, so the ownership switch
 * lives here rather than in the Schedule definition. The backend answers
 * from the `scout_v2_postmatch_ownership_enabled` flag (see
 * `resolvePostMatchDiscoveryOwnerV2`), which is on by default.
 *
 * Only one pipeline discovers at a time, for three reasons:
 *
 * - The Schedule's SKIP overlap policy keeps this run from starting while
 *   the previous scheduled run, V2 or delegated v1, is still open. A V2 run
 *   stays open until the dispatcher has acknowledged every match it handed
 *   over, and a delegated v1 run is awaited here.
 * - A run started by another trigger (an operator, say) passes through this
 *   same gate. When v1 owns discovery, the backend defers while any live
 *   poll still holds `BotState`, because v1's discovery overwrites the poll
 *   row rather than claiming it.
 * - In the other direction, V2's durable claim already refuses a poll that
 *   v1 opened, so V2 skips while a v1 pass is running.
 *
 * Match-processing children already started by V2 are left alone. They run
 * under `ABANDON` from the dispatcher, keep their per-match observation
 * ownership, and finish whatever the flag says.
 */
export async function delegateWhenV1OwnsDiscovery(
  input: ScoutPostMatchDiscoveryV2Input,
): Promise<ScoutPostMatchDiscoveryV2ResultEnvelope | null> {
  if (!patched(SCOUT_V2_POSTMATCH_OWNERSHIP_PATCH)) return null;
  setWorkflowPhase("**Phase:** resolving post-match discovery ownership");
  const owner = await realtimeV2Activities(
    input.stage,
  ).resolvePostMatchDiscoveryOwnerV2(input);
  if (owner.decision === "run-v2") return null;
  if (owner.decision === "defer-v1") {
    setWorkflowPhase(
      `**Phase:** v1 owns discovery; deferring while the poll opened at ${owner.pollHeldSince} still runs`,
    );
    return scoutPostMatchDiscoveryV2ResultCodec.serialize({
      status: "no-op",
      discovered: 0,
      childrenStarted: 0,
      complete: false,
    });
  }
  setWorkflowPhase(
    "**Phase:** v1 owns discovery; running v1 post-match discovery",
  );
  const workflowId = legacyPostMatchDiscoveryWorkflowId(
    workflowInfo().workflowId,
  );
  const legacy = await executeChild(scoutPostMatchDiscoveryWorkflow, {
    workflowId,
    workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
    taskQueue: scoutTaskQueues(input.stage).workflow,
    // v1's own match-ingestion children run under ABANDON, so ending this
    // run early never cancels a match in flight; it only ends the pass.
    parentClosePolicy: "TERMINATE",
    args: [{ stage: input.stage }],
  });
  return scoutPostMatchDiscoveryV2ResultCodec.serialize({
    status: legacy.status,
    discovered: 0,
    childrenStarted: 0,
    complete: false,
    delegatedTo: {
      workflowType: SCOUT_WORKFLOW_NAMES.postMatchDiscovery,
      workflowId,
      childrenStarted: legacy.childrenStarted,
    },
  });
}
