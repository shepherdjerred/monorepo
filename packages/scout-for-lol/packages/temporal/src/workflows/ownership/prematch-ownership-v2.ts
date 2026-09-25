import { startChild } from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import type {
  ScoutPrematchPassClaimV2Input,
  ScoutPrematchPassOwnerV2Result,
} from "#src/activity-contracts-v2.ts";
import type {
  ScoutRealtimePollInput,
  ScoutWorkflowStatus,
} from "#src/contracts.ts";
import {
  scoutPrematchDiscoveryV2WorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import { scoutPrematchDiscoveryV2InputCodec } from "#src/workflow-contracts-v2.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import {
  realtimeActivities,
  realtimeV2Activities,
} from "#src/workflows/activity-options.ts";
import { scoutPrematchDiscoveryV2Workflow } from "#src/workflows/prematch-v2.ts";
import { awaitWhileRenewing } from "./claim-renewal.ts";

/**
 * The marker for prematch polls that asked who owns the pass.
 *
 * The ownership read is an inserted command at the head of the prematch arm
 * of `scoutRealtimePollWorkflow`, so a poll recorded before it replays
 * through the gate as `false` and goes straight to v1's `pollRealtime`,
 * which is exactly what that generation did. Only the prematch arm calls
 * `patched` with it: a tournament-lobby poll never records the marker.
 * Never rename it: a patch id names one change to this Workflow's command
 * sequence for as long as an execution that recorded it can replay.
 */
export const SCOUT_V2_PREMATCH_OWNERSHIP_PATCH = "scout-v2-prematch-ownership";

/**
 * How often the router renews its claim while the pass runs.
 *
 * Well inside the 5-minute staleness bound (`PREMATCH_PASS_STALE_AFTER_MS` in
 * the backend), so a few delayed renewals still leave the claim live. An
 * ordinary pass settles in seconds and never renews at all.
 */
export const PREMATCH_CLAIM_RENEWAL_INTERVAL = "1 minute";

/**
 * Run one prematch pass under the pipeline that owns it.
 *
 * The `prematch-poll` Schedule always starts `scoutRealtimePollWorkflow`, in
 * every stage, so the V2 cutover cannot be a Schedule change: Schedules
 * deploy separately from each stage's image, and a Schedule naming a
 * Workflow Type an image lacks strands that stage. The switch lives here, in
 * the Scout worker's own bundle, and the backend answers it from the
 * `scout_v2_prematch_ownership_enabled` flag (see
 * `resolvePrematchPassOwnerV2`), which is off by default.
 *
 * Only one pipeline detects live games at a time, because every pass takes
 * the same durable prematch pass claim on `BotState` before doing anything.
 * The claim is one guarded statement, so of two overlapping passes (the
 * scheduled run and an operator's, say), exactly one proceeds and the other
 * returns `no-op`. The claim is renewed while the pass runs and released
 * when it ends, whether it succeeded or failed.
 *
 * - `run-v1` runs v1's `pollRealtime` with this run's input, unchanged.
 * - `run-v2` runs `scoutPrematchDiscoveryV2Workflow` as a child and waits for
 *   it, then runs `pollRealtime` with `activeGameDetectionOwner: "v2"` so v1's
 *   prematch maintenance still runs without v1 detecting games itself.
 *
 * Per-game capture children the V2 discovery starts run under `ABANDON` and
 * finish whatever the flag says next. The two pipelines also refuse each
 * other's games: v1 skips a game whose V2 capture Workflow is running or
 * completed, and V2 discovery skips a game v1 holds a live `ActiveGame` row
 * for, so a flip mid-game neither announces a game twice nor opens its
 * markets twice.
 */
export async function runOwnedPrematchPass(
  input: ScoutRealtimePollInput,
): Promise<ScoutWorkflowStatus> {
  setWorkflowPhase("**Phase:** resolving prematch pass ownership");
  const owner = await realtimeV2Activities(
    input.stage,
  ).resolvePrematchPassOwnerV2({ stage: input.stage });
  if (owner.decision === "defer") {
    setWorkflowPhase(
      `**Phase:** deferring while another run holds the prematch pass claimed at ${owner.heldSince ?? "an unknown time"}`,
    );
    return "no-op";
  }
  const claim: ScoutPrematchPassClaimV2Input = {
    stage: input.stage,
    holder: owner.holder,
  };
  try {
    await awaitWhileRenewing(
      runClaimedPass(input, owner),
      PREMATCH_CLAIM_RENEWAL_INTERVAL,
      async () => {
        await realtimeV2Activities(input.stage).renewPrematchPassClaimV2(claim);
      },
    );
  } catch (error) {
    setWorkflowPhase(
      "**Phase:** the prematch pass failed; releasing its claim",
    );
    await realtimeV2Activities(input.stage).releasePrematchPassClaimV2(claim);
    throw error;
  }
  await realtimeV2Activities(input.stage).releasePrematchPassClaimV2(claim);
  return "completed";
}

async function runClaimedPass(
  input: ScoutRealtimePollInput,
  owner: Exclude<ScoutPrematchPassOwnerV2Result, { decision: "defer" }>,
): Promise<void> {
  if (owner.decision === "run-v1") {
    setWorkflowPhase("**Phase:** v1 owns prematch; polling realtime state");
    await realtimeActivities(input.stage).pollRealtime(input);
    return;
  }
  await runV2Discovery(input);
  setWorkflowPhase(
    "**Phase:** V2 owns prematch; running v1 prematch maintenance",
  );
  await realtimeActivities(input.stage).pollRealtime({
    ...input,
    activeGameDetectionOwner: "v2",
  });
}

/**
 * Run this pass's V2 prematch discovery and wait for it.
 *
 * The child takes the stage's singleton discovery ID, so Temporal itself
 * refuses a second V2 discovery while one runs. Under the pass claim that
 * should never happen, but an operator can start the V2 Workflow directly;
 * a refused start then means that execution is detecting this tick's games,
 * which is an answer rather than a fault, and the pass continues into
 * maintenance.
 */
async function runV2Discovery(input: ScoutRealtimePollInput): Promise<void> {
  setWorkflowPhase("**Phase:** V2 owns prematch; running V2 discovery");
  try {
    const child = await startChild(scoutPrematchDiscoveryV2Workflow, {
      workflowId: scoutPrematchDiscoveryV2WorkflowId(input.stage),
      // One ID per stage, reused by every pass.
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
      taskQueue: scoutTaskQueues(input.stage).workflow,
      // The per-game children run under ABANDON, so ending this run early
      // never cancels a capture in flight; it only ends the scan.
      parentClosePolicy: "TERMINATE",
      args: [
        scoutPrematchDiscoveryV2InputCodec.serialize({ stage: input.stage }),
      ],
    });
    await child.result();
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    setWorkflowPhase(
      "**Phase:** a V2 prematch discovery is already running for this stage",
    );
  }
}
