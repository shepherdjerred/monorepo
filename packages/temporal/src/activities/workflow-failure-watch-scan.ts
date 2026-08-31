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

export async function scanWorkflowFailureVisibility(
  client: WorkflowVisibilityClient,
  options: ScanWorkflowFailureVisibilityOptions,
): Promise<WorkflowFailureVisibilityScan> {
  const pendingDetails: FailedWorkflowExecution[] = [];
  const overflowBatch: FailedWorkflowExecution[] = [];
  let scanned = 0;
  let detailedAlertsSelected = options.detailedAlertsConsumed;
  let listingError: Error | undefined;
  let processingBatch = false;
  let overflowed = false;
  try {
    for await (const info of client.workflow.list({
      query: options.query,
      pageSize: VISIBILITY_PAGE_SIZE,
    })) {
      const status = toFailureStatusName(info.status.name);
      if (status === undefined || info.closeTime === undefined) continue;
      const execution = {
        workflowId: info.workflowId,
        runId: info.runId,
        workflowType: info.type,
        taskQueue: info.taskQueue,
        startTime: info.startTime,
        closeTime: info.closeTime,
        status,
      } satisfies FailedWorkflowExecution;
      if (
        options.checkpoint !== undefined &&
        !isAfterVisibilityCursor(execution, options.checkpoint)
      ) {
        continue;
      }
      scanned += 1;
      if (detailedAlertsSelected >= MAX_DETAILED_FAILURE_ALERTS) {
        overflowBatch.push(execution);
        if (overflowBatch.length === ALERT_BATCH_SIZE) {
          processingBatch = true;
          await options.onOverflowBatch(overflowBatch);
          processingBatch = false;
          overflowed = true;
          overflowBatch.length = 0;
        }
        continue;
      }
      pendingDetails.push(execution);
      detailedAlertsSelected += 1;
      if (pendingDetails.length === ALERT_BATCH_SIZE) {
        processingBatch = true;
        await options.onDetailBatch(pendingDetails);
        processingBatch = false;
        pendingDetails.length = 0;
      }
    }
    if (overflowBatch.length > 0) {
      processingBatch = true;
      await options.onOverflowBatch(overflowBatch);
      processingBatch = false;
      overflowed = true;
    }
  } catch (error) {
    if (processingBatch) throw error;
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
