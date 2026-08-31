import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";
import type { WorkflowVisibilityClient } from "#shared/workflow-visibility-client.ts";
import {
  workflowExecutionKey,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";
import { MAX_DETAILED_FAILURE_ALERTS } from "./workflow-failure-watch-overflow.ts";

const ALERT_BATCH_SIZE = 25;
const VISIBILITY_PAGE_SIZE = 100;
const FAILURE_STATUS_NAMES = ["FAILED", "TIMED_OUT"] as const;
type FailureStatusName = (typeof FAILURE_STATUS_NAMES)[number];

type ScanWorkflowFailureVisibilityOptions = {
  query: string;
  checkpoint: WorkflowFailureWatchCheckpoint | undefined;
  detailedAlertsConsumed: number;
  onDetailBatch: (
    executions: readonly FailedWorkflowExecution[],
  ) => Promise<void>;
  onOverflowBatch: (
    executions: readonly FailedWorkflowExecution[],
  ) => Promise<void>;
};

type WorkflowVisibilityInfo = {
  workflowId: string;
  runId: string;
  type: string;
  taskQueue: string;
  startTime: Date;
  closeTime?: Date;
  status: { name: string };
};

export type WorkflowFailureVisibilityScan = {
  pendingDetails: FailedWorkflowExecution[];
  overflowed: boolean;
  scanned: number;
  detailedAlertsSelected: number;
  listingError: Error | undefined;
};

function toFailureStatusName(name: string): FailureStatusName | undefined {
  return FAILURE_STATUS_NAMES.find((candidate) => candidate === name);
}

function isAfterVisibilityCursor(
  execution: Pick<
    FailedWorkflowExecution,
    "workflowId" | "closeTime" | "runId"
  >,
  checkpoint: WorkflowFailureWatchCheckpoint,
): boolean {
  const cursor = checkpoint.cursor;
  if (cursor === undefined) return true;
  const executionCloseTimeMs = execution.closeTime.getTime();
  const checkpointCloseTimeMs = cursor.closeTime.getTime();
  if (executionCloseTimeMs < checkpointCloseTimeMs) return true;
  if (executionCloseTimeMs > checkpointCloseTimeMs) return false;
  return !(cursor.processedExecutionKeys ?? []).includes(
    workflowExecutionKey(execution.workflowId, execution.runId),
  );
}

function failureExecutionFromVisibilityInfo(
  info: WorkflowVisibilityInfo,
): FailedWorkflowExecution | undefined {
  const status = toFailureStatusName(info.status.name);
  if (status === undefined || info.closeTime === undefined) return undefined;
  return {
    workflowId: info.workflowId,
    runId: info.runId,
    workflowType: info.type,
    taskQueue: info.taskQueue,
    startTime: info.startTime,
    closeTime: info.closeTime,
    status,
  } satisfies FailedWorkflowExecution;
}

async function flushBatch(
  batch: FailedWorkflowExecution[],
  callback: (executions: readonly FailedWorkflowExecution[]) => Promise<void>,
  setProcessing: (processing: boolean) => void,
): Promise<void> {
  if (batch.length === 0) return;
  setProcessing(true);
  await callback(batch);
  setProcessing(false);
  batch.length = 0;
}

type QueueExecutionResult = {
  detailedAlertsSelected: number;
  overflowed: boolean;
};

type QueueExecutionInput = {
  execution: FailedWorkflowExecution;
  detailedAlertsSelected: number;
  pendingDetails: FailedWorkflowExecution[];
  overflowBatch: FailedWorkflowExecution[];
  options: ScanWorkflowFailureVisibilityOptions;
  setProcessing: (processing: boolean) => void;
};

async function queueExecution(
  input: QueueExecutionInput,
): Promise<QueueExecutionResult> {
  const {
    execution,
    detailedAlertsSelected,
    pendingDetails,
    overflowBatch,
    options,
    setProcessing,
  } = input;
  if (detailedAlertsSelected >= MAX_DETAILED_FAILURE_ALERTS) {
    overflowBatch.push(execution);
    if (overflowBatch.length === ALERT_BATCH_SIZE) {
      await flushBatch(overflowBatch, options.onOverflowBatch, setProcessing);
      return { detailedAlertsSelected, overflowed: true };
    }
    return { detailedAlertsSelected, overflowed: false };
  }
  pendingDetails.push(execution);
  const nextDetailedAlertsSelected = detailedAlertsSelected + 1;
  if (pendingDetails.length === ALERT_BATCH_SIZE) {
    await flushBatch(pendingDetails, options.onDetailBatch, setProcessing);
  }
  return {
    detailedAlertsSelected: nextDetailedAlertsSelected,
    overflowed: false,
  };
}

export async function scanWorkflowFailureVisibility(
  client: WorkflowVisibilityClient,
  options: ScanWorkflowFailureVisibilityOptions,
): Promise<WorkflowFailureVisibilityScan> {
  const pendingDetails: FailedWorkflowExecution[] = [];
  const overflowBatch: FailedWorkflowExecution[] = [];
  let scanned = 0;
  let detailedAlertsSelected = options.detailedAlertsConsumed;
  let listingError: Error | undefined;
  const processingState = { active: false };
  let overflowed = false;
  try {
    for await (const info of client.workflow.list({
      query: options.query,
      pageSize: VISIBILITY_PAGE_SIZE,
    })) {
      const execution = failureExecutionFromVisibilityInfo(info);
      if (execution === undefined) continue;
      if (
        options.checkpoint !== undefined &&
        !isAfterVisibilityCursor(execution, options.checkpoint)
      )
        continue;
      scanned += 1;
      const queueResult = await queueExecution({
        execution,
        detailedAlertsSelected,
        pendingDetails,
        overflowBatch,
        options,
        setProcessing: (processing) => {
          processingState.active = processing;
        },
      });
      detailedAlertsSelected = queueResult.detailedAlertsSelected;
      overflowed ||= queueResult.overflowed;
    }
    if (overflowBatch.length > 0) {
      await flushBatch(overflowBatch, options.onOverflowBatch, (processing) => {
        processingState.active = processing;
      });
      overflowed = true;
    }
  } catch (error) {
    if (processingState.active) throw error;
    listingError = error instanceof Error ? error : new Error(String(error));
  }
  return {
    pendingDetails,
    overflowed,
    scanned,
    detailedAlertsSelected,
    listingError,
  };
}
