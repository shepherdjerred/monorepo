import { patched, startChild, workflowInfo } from "@temporalio/workflow";
import {
  defineSearchAttributeKey,
  SearchAttributeType,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/common";
import {
  ScoutMatchIngestionInputSchema,
  PostMatchDiscoveryResultSchema,
  ScoutPostMatchDiscoveryInputSchema,
  ScoutRealtimePollInputSchema,
  type PostMatchDiscoveryResult,
  type ScoutMatchIngestionInput,
  type ScoutPostMatchDiscoveryInput,
  type ScoutRealtimePollInput,
  type ScoutWorkflowStatus,
} from "#src/contracts.ts";
import { scoutMatchWorkflowId, scoutTaskQueues } from "#src/identifiers.ts";
import { realtimeActivities } from "./activity-options.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import {
  runOwnedPrematchPass,
  SCOUT_V2_PREMATCH_OWNERSHIP_PATCH,
} from "./ownership/prematch-ownership-v2.ts";

/**
 * Guards the reconciliation command added to the already-started collision
 * path. Retire it only once no discovery execution predating that change can
 * still be open — they are short-lived, but a retrying maintenance activity
 * keeps one open well past the poll that started it.
 */
const COLLISION_RECONCILIATION_PATCH = "postmatch-collision-reconciliation";

const TemporalScheduledStartTime = defineSearchAttributeKey(
  "TemporalScheduledStartTime",
  SearchAttributeType.DATETIME,
);

export async function scoutRealtimePollWorkflow(
  rawInput: ScoutRealtimePollInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutRealtimePollInputSchema.parse(rawInput);
  const scheduleTime = workflowInfo().typedSearchAttributes.get(
    TemporalScheduledStartTime,
  );
  const scheduledStart =
    input.scheduledStartAt === undefined
      ? (scheduleTime ?? workflowInfo().startTime).getTime()
      : new Date(input.scheduledStartAt).getTime();
  if (Date.now() - scheduledStart > input.maximumAgeSeconds * 1000) {
    setWorkflowPhase("**Phase:** skipped because the poll was stale");
    return "stale";
  }
  // Only the prematch arm is routed, and only it records the patch marker:
  // a tournament-lobby poll keeps its recorded command sequence exactly.
  if (input.kind === "prematch" && patched(SCOUT_V2_PREMATCH_OWNERSHIP_PATCH)) {
    return await runOwnedPrematchPass(input);
  }
  setWorkflowPhase("**Phase:** polling realtime Scout state");
  await realtimeActivities(input.stage).pollRealtime(input);
  return "completed";
}

export async function scoutMatchIngestionWorkflow(
  rawInput: ScoutMatchIngestionInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutMatchIngestionInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** ingesting a completed match");
  await realtimeActivities(input.stage).ingestMatch(input);
  return "completed";
}

type DiscoveredMatchOutcome =
  "ingested-here" | "ingested-elsewhere" | "owned-elsewhere";

/**
 * Drive one discovered match to a conclusion, or report who else owns it.
 *
 * A child FAILURE propagates: a run that discovered an unprocessable match must
 * fail visibly rather than report a discovery that quietly did less than it
 * found. Only the already-started rejection is an answer rather than a fault,
 * and then only once the owning execution's status says which answer it is.
 */
async function processDiscoveredMatch(
  stage: ScoutPostMatchDiscoveryInput["stage"],
  match: PostMatchDiscoveryResult["matches"][number],
): Promise<DiscoveredMatchOutcome> {
  try {
    const child = await startChild(scoutMatchIngestionWorkflow, {
      workflowId: scoutMatchWorkflowId(stage, match.matchId),
      workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
      taskQueue: scoutTaskQueues(stage).workflow,
      parentClosePolicy: "ABANDON",
      args: [{ stage, ...match }],
    });
    // Bounded Dare plans are ordered by match end time. Discovery force-polls
    // every frozen account in an active Dare, globally orders their completed
    // matches, and fails the batch if any target or timestamp is unavailable.
    // Do not allow a later child to capture evidence and settle while an
    // earlier child is still ingesting.
    await child.result();
    return "ingested-here";
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    if (!patched(COLLISION_RECONCILIATION_PATCH)) {
      // An execution that hit this collision under the previous build recorded
      // no reconciliation command here and went straight to maintenance before
      // failing. A run can still be open at that point with maintenance pending
      // or retrying, so replaying it must keep the old command sequence
      // exactly; scheduling the activity below would report nondeterminism
      // instead of letting it finish.
      throw error;
    }
    // Match IDs are permanent, so if the owning execution already finished, no
    // future run can start this child either — the account that rediscovered it
    // would be pinned here forever, starving every later match. Completing the
    // run without moving anything would swap a loud failure for a silent stall,
    // so confirm the child completed and move that account's cursor past the
    // match before carrying on.
    const reconciliation = await realtimeActivities(
      stage,
    ).reconcileIngestedMatchCursor({ stage, ...match });
    return reconciliation.outcome === "reconciled"
      ? "ingested-elsewhere"
      : "owned-elsewhere";
  }
}

export async function scoutPostMatchDiscoveryWorkflow(
  rawInput: ScoutPostMatchDiscoveryInput,
): Promise<{ status: ScoutWorkflowStatus; childrenStarted: number }> {
  const input = ScoutPostMatchDiscoveryInputSchema.parse(rawInput);
  setWorkflowPhase("**Phase:** discovering completed matches");
  const discovered = PostMatchDiscoveryResultSchema.parse(
    await realtimeActivities(input.stage).discoverPostMatchIds(input),
  );
  let childrenStarted = 0;
  let ownedWholeTail = true;
  let childFailure: unknown;
  for (const match of discovered.matches) {
    let outcome: DiscoveredMatchOutcome;
    try {
      outcome = await processDiscoveredMatch(input.stage, match);
    } catch (error) {
      childFailure = error;
      break;
    }
    if (outcome === "ingested-here") {
      childrenStarted += 1;
      continue;
    }
    // Already carried through by the execution that owns the ID, so this run
    // has seen the match through as surely as if it had started the child.
    if (outcome === "ingested-elsewhere") continue;
    // The owning execution has not completed, so nothing it was supposed to do
    // can be assumed done. Stopping preserves the chronology the serialization
    // exists to protect, and withholding settlement is the honest report of a
    // partial pass — but it is an answer, not a fault, so the run completes
    // rather than failing. Mirrors `ownedWholeTail` in
    // `scoutPostMatchDiscoveryV2Workflow`.
    ownedWholeTail = false;
    break;
  }
  setWorkflowPhase("**Phase:** running post-match maintenance");
  await realtimeActivities(input.stage).runPostMatchMaintenance({
    ...input,
    settleDareV2Deadlines:
      discovered.evidenceComplete &&
      ownedWholeTail &&
      childFailure === undefined,
    evidenceWatermark: discovered.evidenceWatermark,
  });
  if (childFailure !== undefined) {
    if (childFailure instanceof Error) throw childFailure;
    throw new Error("Match-ingestion child failed with a non-Error value", {
      cause: childFailure,
    });
  }
  return { status: "completed", childrenStarted };
}
