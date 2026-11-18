import type { FailedWorkflowExecution } from "#shared/alerts/workflow-failure-alert.ts";
import type { WorkflowVisibilityClient } from "#shared/infra/workflow-visibility-client.ts";
import type { TemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import {
  workflowExecutionKey,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";
import { MAX_DETAILED_FAILURE_ALERTS } from "./workflow-failure-watch-overflow.ts";
import { extractScheduleIdentity } from "./workflow-failure-watch-stability.ts";
import { withWorkflowFailureRpcTimeout } from "./workflow-failure-watch-timeout.ts";

const ALERT_BATCH_SIZE = 25;
const VISIBILITY_PAGE_SIZE = 100;
const FAILURE_STATUS_NAMES = ["FAILED", "TIMED_OUT"] as const;
type FailureStatusName = (typeof FAILURE_STATUS_NAMES)[number];

type ScanWorkflowFailureVisibilityOptions = {
  namespace: TemporalNamespace;
  query: string;
  rpcTimeoutMs: number;
  checkpoint: WorkflowFailureWatchCheckpoint | undefined;
  detailedAlertsConsumed: number;
  onDetailBatch: (
    executions: readonly FailedWorkflowExecution[],
  ) => Promise<void>;
  onOverflowBatch: (
    executions: readonly FailedWorkflowExecution[],
  ) => Promise<void>;
  onObservedFailure?: (execution: FailedWorkflowExecution) => void;
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

function toFailedWorkflowExecution(
  info: {
    readonly workflowId: string;
    readonly runId: string;
    readonly type: string;
    readonly taskQueue: string;
    readonly startTime: Date;
    readonly closeTime?: Date;
    readonly status: { readonly name: string };
  },
  namespace: TemporalNamespace,
): FailedWorkflowExecution | undefined {
  const status = toFailureStatusName(info.status.name);
  if (status === undefined || info.closeTime === undefined) {
    return undefined;
  }
  const scheduleIdentity = extractScheduleIdentity(info);
  return {
    temporalNamespace: namespace,
    workflowId: info.workflowId,
    runId: info.runId,
    workflowType: info.type,
    taskQueue: info.taskQueue,
    ...(scheduleIdentity === undefined
      ? {}
      : {
          scheduleId: scheduleIdentity.scheduleId,
          scheduledByAttribute: scheduleIdentity.scheduledByAttribute,
        }),
    startTime: info.startTime,
    closeTime: info.closeTime,
    status,
  };
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
  return (
    executionCloseTimeMs <= checkpointCloseTimeMs &&
    (executionCloseTimeMs < checkpointCloseTimeMs ||
      !(cursor.processedExecutionKeys ?? []).includes(
        workflowExecutionKey(execution.workflowId, execution.runId),
      ))
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
    // Manual iteration (not `for await`) so each page fetch races a timeout:
    // a hung visibility read becomes a listing error — retried from the
    // streamed checkpoint — instead of burning the activity attempt.
    const iterator = client.workflow
      .list({
        query: options.query,
        pageSize: VISIBILITY_PAGE_SIZE,
      })
      [Symbol.asyncIterator]();
    let scanComplete = false;
    while (!scanComplete) {
      const next = await withWorkflowFailureRpcTimeout(
        iterator.next(),
        "visibility-list-next",
        options.rpcTimeoutMs,
      );
      if (next.done === true) {
        scanComplete = true;
        continue;
      }
      const execution = toFailedWorkflowExecution(
        next.value,
        options.namespace,
      );
      if (execution === undefined) {
        continue;
      }
      options.onObservedFailure?.(execution);
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
