import { executeChild, patched, workflowInfo } from "@temporalio/workflow";
import type { IsoInstant } from "@scout-for-lol/domain/identity/brands.ts";
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
 * lives here, in the Scout worker's own bundle, rather than in the Schedule
 * definition. The backend answers from the
 * `scout_v2_postmatch_ownership_enabled` flag (see
 * `resolvePostMatchDiscoveryOwnerV2`), which is on by default.
 *
 * Only one pipeline discovers at a time, because both take the same durable
 * poll claim on `BotState` before discovering:
 *
 * - V2 discovery claims the poll in its discovery Activity and holds the
 *   claim until its maintenance closes it.
 * - The v1 handoff claims the poll in the ownership Activity, before the v1
 *   child starts. The child re-presents that claim instead of opening the
 *   poll unconditionally, and its maintenance closes it.
 *
 * A run that finds the claim held does nothing: V2 discovery reports
 * `skipped`, and the handoff reports `defer-v1`. Both return `no-op`.
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
      `**Phase:** v1 owns discovery; deferring while another run holds the poll claimed at ${owner.pollHeldSince ?? "an unknown time"}`,
    );
    return scoutPostMatchDiscoveryV2ResultCodec.serialize({
      status: "no-op",
      discovered: 0,
      childrenStarted: 0,
      complete: false,
    });
  }
  return await runDelegatedV1Pass(input, owner.pollOwner);
}

/**
 * Run v1 discovery as a child under the claim the handoff took.
 *
 * On success, v1's maintenance has closed the claim. If the child fails, the
 * claim is closed here as failed, so the next pass need not wait out the
 * staleness bound, and the failure then propagates.
 */
async function runDelegatedV1Pass(
  input: ScoutPostMatchDiscoveryV2Input,
  pollOwner: IsoInstant,
): Promise<ScoutPostMatchDiscoveryV2ResultEnvelope> {
  setWorkflowPhase(
    "**Phase:** v1 owns discovery; running v1 post-match discovery",
  );
  const workflowId = legacyPostMatchDiscoveryWorkflowId(
    workflowInfo().workflowId,
  );
  let legacy: Awaited<ReturnType<typeof scoutPostMatchDiscoveryWorkflow>>;
  try {
    legacy = await executeChild(scoutPostMatchDiscoveryWorkflow, {
      workflowId,
      workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
      taskQueue: scoutTaskQueues(input.stage).workflow,
      // v1's own match-ingestion children run under ABANDON, so ending this
      // run early never cancels a match in flight; it only ends the pass.
      parentClosePolicy: "TERMINATE",
      args: [{ stage: input.stage, pollOwner }],
    });
  } catch (error) {
    setWorkflowPhase(
      "**Phase:** v1 post-match discovery failed; releasing its poll claim",
    );
    await realtimeV2Activities(input.stage).releasePostMatchPollClaimV2({
      stage: input.stage,
      pollOwner,
    });
    throw error;
  }
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
