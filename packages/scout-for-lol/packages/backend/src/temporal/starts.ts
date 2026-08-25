import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowHandle,
} from "@temporalio/client";
import type { Client } from "@temporalio/client";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutFixedScheduleId,
  scoutInitialHistoryWorkflowId,
  scoutInteractiveWorkflowId,
  scoutMatchWorkflowId,
  scoutReportScheduleReconcilerWorkflowId,
  scoutTaskQueues,
  type ScoutInitialHistoryInput,
  type ScoutInteractiveRunInput,
  type ScoutMatchIngestionInput,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import { reconcileReportSchedulesSignal } from "@scout-for-lol/temporal/signals";

const IDEMPOTENT_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

export async function startScoutMatchIngestion(
  client: Client,
  input: ScoutMatchIngestionInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.matchIngestion, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutMatchWorkflowId(input.stage, input.matchId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
  });
}

export async function startScoutInitialHistory(
  client: Client,
  input: ScoutInitialHistoryInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.initialHistory, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutInitialHistoryWorkflowId(input.stage, input.puuid),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
  });
}

export async function triggerScoutIngestionReconciliationSchedule(
  client: Client,
  stage: ScoutStage,
): Promise<void> {
  await client.schedule
    .getHandle(scoutFixedScheduleId(stage, "ingestion-reconciliation"))
    .trigger();
}

export async function startScoutInteractiveRun(
  client: Client,
  input: ScoutInteractiveRunInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.interactiveRun, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutInteractiveWorkflowId(
      input.stage,
      input.kind,
      input.databaseRunId,
    ),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
  });
}

export async function signalScoutReportReconciliation(
  client: Client,
  stage: ScoutStage,
): Promise<WorkflowHandle> {
  return await client.workflow.signalWithStart(
    SCOUT_WORKFLOW_NAMES.reportScheduleReconciler,
    {
      ...IDEMPOTENT_START_POLICIES,
      workflowId: scoutReportScheduleReconcilerWorkflowId(stage),
      taskQueue: scoutTaskQueues(stage).workflow,
      args: [{ stage }],
      signal: reconcileReportSchedulesSignal,
      signalArgs: [],
    },
  );
}
