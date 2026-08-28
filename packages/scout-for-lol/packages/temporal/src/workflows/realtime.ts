import { startChild, workflowInfo } from "@temporalio/workflow";
import {
  defineSearchAttributeKey,
  SearchAttributeType,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/common";
import {
  ScoutMatchIngestionInputSchema,
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
  const discovered = await realtimeActivities(input.stage).discoverPostMatchIds(
    input,
  );
  let childrenStarted = 0;
  for (const match of discovered.matches) {
    try {
      await startChild(scoutMatchIngestionWorkflow, {
        workflowId: scoutMatchWorkflowId(input.stage, match.matchId),
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        taskQueue: scoutTaskQueues(input.stage).workflow,
        parentClosePolicy: "ABANDON",
        args: [{ stage: input.stage, ...match }],
      });
      childrenStarted += 1;
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  setWorkflowPhase("**Phase:** running post-match maintenance");
  await realtimeActivities(input.stage).runPostMatchMaintenance(input);
  return { status: "completed", childrenStarted };
}
