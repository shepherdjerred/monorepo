import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type Client,
  type WorkflowHandleWithFirstExecutionRunId,
} from "@temporalio/client";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutLakeProjectionV2WorkflowId,
  scoutNotificationV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
  scoutTaskQueues,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import {
  scoutLakeProjectionV2InputCodec,
  scoutNotificationV2InputCodec,
  scoutPipelineReconciliationV2InputCodec,
  type ScoutLakeProjectionV2Input,
  type ScoutNotificationV2Input,
  type ScoutPipelineReconciliationV2Input,
} from "@scout-for-lol/temporal/workflow-contracts-v2";
import {
  buildTemporalExecutionStartMetadata,
  ExecutionMetadataSchema,
} from "@scout-for-lol/temporal/execution-metadata";
import configuration from "#src/configuration.ts";

/**
 * Client starts for the V2 Workflows an operator can drive.
 *
 * These exist beside `starts.ts` rather than inside it because V2 differs in
 * one way that matters at the call site: the Workflow argument is a VERSIONED
 * ENVELOPE, not the flat input. `scoutLakeProjectionV2InputCodec.serialize`
 * produces `{ kind: "scout-lake-projection-v2-input", ... }`, while the durable
 * `ScoutWorkflowStart` row stores an envelope keyed by the WORKFLOW TYPE. The
 * two envelopes are deliberately different, so the conversion is done here,
 * once, next to the contract it belongs to.
 *
 * Every start here is joined rather than duplicated: `USE_EXISTING` returns a
 * handle to a live execution instead of racing a second one, and
 * `REJECT_DUPLICATE` refuses to silently re-run a Workflow id that has already
 * closed. A caller that wants to know it joined reads the run id, which is the
 * evidence `ScoutWorkflowStart` records.
 */

const OPERATOR_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

function operatorStartMetadata(
  stage: ScoutStage,
  summary: string,
  description: string,
) {
  return buildTemporalExecutionStartMetadata({
    metadata: ExecutionMetadataSchema.parse({
      Environment: stage,
      Domain: "scout",
      Trigger: "operator",
      ReleaseCommit: configuration.gitSha,
    }),
    summary,
    description,
  });
}

export async function startScoutPipelineReconciliationV2(
  client: Client,
  input: ScoutPipelineReconciliationV2Input,
): Promise<WorkflowHandleWithFirstExecutionRunId> {
  return await client.workflow.start(
    SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
    {
      ...OPERATOR_START_POLICIES,
      workflowId: scoutPipelineReconciliationV2WorkflowId(
        input.stage,
        input.trigger,
      ),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      args: [scoutPipelineReconciliationV2InputCodec.serialize(input)],
      ...operatorStartMetadata(
        input.stage,
        "Reconcile the Scout durable pipeline",
        "Sweeps for durable match work whose owner dropped it and re-drives each family.",
      ),
    },
  );
}

export async function startScoutLakeProjectionV2(
  client: Client,
  input: ScoutLakeProjectionV2Input,
): Promise<WorkflowHandleWithFirstExecutionRunId> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.lakeProjectionV2, {
    ...OPERATOR_START_POLICIES,
    workflowId: scoutLakeProjectionV2WorkflowId(input.stage, input.riotMatchId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [scoutLakeProjectionV2InputCodec.serialize(input)],
    ...operatorStartMetadata(
      input.stage,
      "Repair a Scout lake projection",
      "Re-runs report-lake staging for one archived match whose projection never landed.",
    ),
  });
}

export async function startScoutNotificationV2(
  client: Client,
  input: ScoutNotificationV2Input,
): Promise<WorkflowHandleWithFirstExecutionRunId> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.notificationV2, {
    ...OPERATOR_START_POLICIES,
    workflowId: scoutNotificationV2WorkflowId(input.stage, input.intentKey),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [scoutNotificationV2InputCodec.serialize(input)],
    ...operatorStartMetadata(
      input.stage,
      "Re-drive a Scout notification intent",
      "Drives one notification intent that is waiting to be sent.",
    ),
  });
}
