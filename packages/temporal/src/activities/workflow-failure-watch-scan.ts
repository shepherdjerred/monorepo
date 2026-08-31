import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";
import type { WorkflowVisibilityClient } from "#shared/workflow-visibility-client.ts";
import type {
  LegacyTemporalNamespace,
  TemporalNamespace,
} from "#shared/temporal-namespace.ts";
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
  namespace: TemporalNamespace | LegacyTemporalNamespace;
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

type ScanState = {
  readonly pendingDetails: FailedWorkflowExecution[];
  readonly overflowBatch: FailedWorkflowExecution[];
  detailedAlertsSelected: number;
  scanned: number;
  listingError: Error | undefined;
  processingBatch: boolean;
  overflowed: boolean;
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

async function processExecution(
  execution: FailedWorkflowExecution,
  options: ScanWorkflowFailureVisibilityOptions,
  state: ScanState,
): Promise<void> {
  state.scanned += 1;
  if (state.detailedAlertsSelected >= MAX_DETAILED_FAILURE_ALERTS) {
    state.overflowBatch.push(execution);
    if (state.overflowBatch.length === ALERT_BATCH_SIZE) {
      state.processingBatch = true;
      await options.onOverflowBatch(state.overflowBatch);
      state.processingBatch = false;
      state.overflowed = true;
      state.overflowBatch.length = 0;
    }
    return;
  }
  state.pendingDetails.push(execution);
  state.detailedAlertsSelected += 1;
  if (state.pendingDetails.length === ALERT_BATCH_SIZE) {
    state.processingBatch = true;
    await options.onDetailBatch(state.pendingDetails);
    state.processingBatch = false;
    state.pendingDetails.length = 0;
  }
}

export async function scanWorkflowFailureVisibility(
  client: WorkflowVisibilityClient,
  options: ScanWorkflowFailureVisibilityOptions,
): Promise<WorkflowFailureVisibilityScan> {
  const state: ScanState = {
    pendingDetails: [],
    overflowBatch: [],
    scanned: 0,
    detailedAlertsSelected: options.detailedAlertsConsumed,
    listingError: undefined,
    processingBatch: false,
    overflowed: false,
  };
  try {
    for await (const info of client.workflow.list({
      query: options.query,
      pageSize: VISIBILITY_PAGE_SIZE,
    })) {
      const status = toFailureStatusName(info.status.name);
      if (status === undefined || info.closeTime === undefined) continue;
      const execution = {
        temporalNamespace: options.namespace,
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
      await processExecution(execution, options, state);
    }
    if (state.overflowBatch.length > 0) {
      state.processingBatch = true;
      await options.onOverflowBatch(state.overflowBatch);
      state.processingBatch = false;
      state.overflowed = true;
    }
  } catch (error) {
    if (state.processingBatch) throw error;
    state.listingError =
      error instanceof Error ? error : new Error(String(error));
  }
  return {
    pendingDetails: state.pendingDetails,
    overflowed: state.overflowed,
    scanned: state.scanned,
    detailedAlertsSelected: state.detailedAlertsSelected,
    listingError: state.listingError,
  };
}
