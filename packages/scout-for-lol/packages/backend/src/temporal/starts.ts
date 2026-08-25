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
  scoutDetachedWorkWorkflowId,
  scoutInteractiveWorkflowId,
  scoutMatchWorkflowId,
  scoutReportScheduleReconcilerWorkflowId,
  scoutQueueCanaryWorkflowId,
  scoutTaskQueues,
  type ScoutInitialHistoryInput,
  type ScoutDetachedWorkInput,
  type ScoutInteractiveRunInput,
  type ScoutMatchIngestionInput,
  type ScoutReportRunInput,
  type ScoutQueueCanaryInput,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import { reconcileReportSchedulesSignal } from "@scout-for-lol/temporal/signals";
import { requestInitialHistoryRunSignal } from "@scout-for-lol/temporal/signals";

const IDEMPOTENT_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

const RESTART_FAILED_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

const RESTART_CLOSED_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
} as const;

export async function startScoutMatchIngestion(
  client: Client,
  input: ScoutMatchIngestionInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.matchIngestion, {
    ...RESTART_FAILED_START_POLICIES,
    workflowId: scoutMatchWorkflowId(input.stage, input.matchId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
  });
}

export async function startScoutQueueCanary(
  client: Client,
  input: ScoutQueueCanaryInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.queueCanary, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutQueueCanaryWorkflowId(input.stage, input.canaryId),
    taskQueue: scoutTaskQueues(input.stage).workflow,
    args: [input],
  });
}

export async function startScoutInitialHistory(
  client: Client,
  input: ScoutInitialHistoryInput,
): Promise<WorkflowHandle> {
  return await client.workflow.signalWithStart(
    SCOUT_WORKFLOW_NAMES.initialHistory,
    {
      ...IDEMPOTENT_START_POLICIES,
      workflowId: scoutInitialHistoryWorkflowId(input.stage, input.puuid),
      taskQueue: scoutTaskQueues(input.stage).workflow,
      args: [input],
      signal: requestInitialHistoryRunSignal,
      signalArgs: [],
    },
  );
}

export async function startScoutDetachedWork(
  client: Client,
  input: ScoutDetachedWorkInput,
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.detachedWork, {
    ...RESTART_FAILED_START_POLICIES,
    workflowId: scoutDetachedWorkWorkflowId(
      input.stage,
      input.kind,
      input.workId,
    ),
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

export async function startScoutManualReport(
  client: Client,
  input: ScoutReportRunInput & { runId: string; source: "manual" },
): Promise<WorkflowHandle> {
  return await client.workflow.start(SCOUT_WORKFLOW_NAMES.reportRun, {
    ...IDEMPOTENT_START_POLICIES,
    workflowId: scoutInteractiveWorkflowId(
      input.stage,
      "manual-report",
      input.runId,
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
      ...RESTART_CLOSED_START_POLICIES,
      workflowId: scoutReportScheduleReconcilerWorkflowId(stage),
      taskQueue: scoutTaskQueues(stage).workflow,
      args: [{ stage }],
      signal: reconcileReportSchedulesSignal,
      signalArgs: [],
    },
  );
}
