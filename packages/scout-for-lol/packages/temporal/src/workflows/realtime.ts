import { startChild, workflowInfo } from "@temporalio/workflow";
import {
  defineSearchAttributeKey,
  SearchAttributeType,
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
    return "stale";
  }
  await realtimeActivities(input.stage).pollRealtime(input);
  return "completed";
}

export async function scoutMatchIngestionWorkflow(
  rawInput: ScoutMatchIngestionInput,
): Promise<ScoutWorkflowStatus> {
  const input = ScoutMatchIngestionInputSchema.parse(rawInput);
  await realtimeActivities(input.stage).ingestMatch(input);
  return "completed";
}

export async function scoutPostMatchDiscoveryWorkflow(
  rawInput: ScoutPostMatchDiscoveryInput,
): Promise<{ status: ScoutWorkflowStatus; childrenStarted: number }> {
  const input = ScoutPostMatchDiscoveryInputSchema.parse(rawInput);
  const discovered = await realtimeActivities(input.stage).discoverPostMatchIds(
    input,
  );
  for (const matchId of discovered.matchIds) {
    await startChild(scoutMatchIngestionWorkflow, {
      workflowId: scoutMatchWorkflowId(input.stage, matchId),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      parentClosePolicy: "ABANDON",
      args: [{ stage: input.stage, matchId }],
    });
  }
  return { status: "completed", childrenStarted: discovered.matchIds.length };
}
