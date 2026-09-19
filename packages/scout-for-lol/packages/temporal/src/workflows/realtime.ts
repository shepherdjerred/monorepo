import { startChild, workflowInfo } from "@temporalio/workflow";
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
  type ScoutMatchIngestionInput,
  type ScoutPostMatchDiscoveryInput,
  type ScoutRealtimePollInput,
  type ScoutWorkflowStatus,
} from "#src/contracts.ts";
import { scoutMatchWorkflowId, scoutTaskQueues } from "#src/identifiers.ts";
import { realtimeActivities } from "./activity-options.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";

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
    try {
      const workflowId = scoutMatchWorkflowId(input.stage, match.matchId);
      const child = await startChild(scoutMatchIngestionWorkflow, {
        workflowId,
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(input.stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [{ stage: input.stage, ...match }],
      });
      childrenStarted += 1;
      // Bounded Dare plans are ordered by match end time. Discovery force-polls
      // every frozen account in an active Dare, globally orders their completed
      // matches, and fails the batch if any target or timestamp is unavailable.
      // Do not allow a later child to capture evidence and settle while an
      // earlier child is still ingesting.
      await child.result();
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        // Another execution owns this match's ID. Match IDs are permanent, so
        // if that execution already finished, no future run can start this
        // child either — the account that rediscovered it would be pinned here
        // forever, starving every later match. Completing the run without
        // moving anything would swap a loud failure for a silent stall, so
        // confirm the ingestion from durable state and move that account's
        // cursor past the match before carrying on.
        const reconciliation = await realtimeActivities(
          input.stage,
        ).reconcileIngestedMatchCursor({ stage: input.stage, ...match });
        if (reconciliation.outcome === "reconciled") {
          // The match is ingested and its evidence captured, so this run has
          // seen it through as surely as if it had run the child itself.
          continue;
        }
        // No proof of ingestion: the owning execution may still be mid-flight.
        // Stopping preserves the chronology the serialization above exists to
        // protect, and withholding settlement is the honest report of a partial
        // pass — but it is an answer, not a fault, so the run completes rather
        // than failing. Mirrors `ownedWholeTail` in
        // `scoutPostMatchDiscoveryV2Workflow`.
        ownedWholeTail = false;
        break;
      }
      childFailure = error;
      break;
    }
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
