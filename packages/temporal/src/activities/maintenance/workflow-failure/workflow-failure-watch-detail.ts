import * as Sentry from "@sentry/bun";
import { WorkflowFailedError } from "@temporalio/client";
import {
  ApplicationFailure,
  TemporalFailure,
  TimeoutFailure,
  TimeoutType,
} from "@temporalio/common";
import { type AlertmanagerAlert } from "#lib/alertmanager.ts";
import {
  buildWorkflowFailureAlert,
  type FailedWorkflowExecution,
  type WorkflowFailureDetail,
} from "#shared/alerts/workflow-failure-alert.ts";
import {
  classifyWorkflowTimeoutHistory,
  type WorkflowTimeoutHistoryClassification,
} from "./workflow-failure-history.ts";
import {
  DEFAULT_WORKFLOW_FAILURE_RPC_TIMEOUT_MS,
  withWorkflowFailureRpcTimeout,
} from "./workflow-failure-watch-timeout.ts";
import type { WorkflowVisibilityClient } from "#shared/infra/workflow-visibility-client.ts";

const COMPONENT = "temporal-failure-watch";

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

function innermostTemporalFailure(failure: TemporalFailure): TemporalFailure {
  let current = failure;
  while (current.cause instanceof TemporalFailure) {
    current = current.cause;
  }
  return current;
}

function failureTypeName(failure: TemporalFailure): string {
  return failure instanceof ApplicationFailure &&
    failure.type !== undefined &&
    failure.type !== null &&
    failure.type !== ""
    ? failure.type
    : failure.name;
}

type TimeoutInspection = {
  classification: WorkflowTimeoutHistoryClassification | undefined;
  historyError: string | undefined;
};

async function inspectTimeoutHistory(
  handle: ReturnType<WorkflowVisibilityClient["workflow"]["getHandle"]>,
  rpcTimeoutMs: number,
): Promise<TimeoutInspection> {
  try {
    return {
      classification: classifyWorkflowTimeoutHistory(
        await withWorkflowFailureRpcTimeout(
          handle.fetchHistory(),
          "fetch-history",
          rpcTimeoutMs,
        ),
      ),
      historyError: undefined,
    };
  } catch (error: unknown) {
    return {
      classification: {
        classification: "unknown",
        workflowTaskScheduled: false,
        workflowTaskStarted: false,
        workflowTaskScheduledButNotStarted: false,
        activityScheduled: false,
        activityStarted: false,
        activityScheduledButNotStarted: false,
        activityScheduleToStartTimedOut: false,
      },
      historyError: error instanceof Error ? error.message : String(error),
    };
  }
}

function workerTaskQueueUnavailableReason(
  classification: WorkflowTimeoutHistoryClassification,
): WorkflowFailureDetail["workerTaskQueueUnavailableReason"] {
  if (classification.activityScheduledButNotStarted) {
    return "a scheduled activity has not started";
  }
  if (classification.workflowTaskScheduledButNotStarted) {
    return "a scheduled workflow task has not started";
  }
  return !classification.workflowTaskStarted && !classification.activityStarted
    ? "no activity reached execution"
    : undefined;
}

function timeoutFailureFields(
  workflowType: string,
  inspection: TimeoutInspection,
  timeoutType: TimeoutType | undefined,
): Pick<
  WorkflowFailureDetail,
  | "timeoutClassification"
  | "timeoutDispatchState"
  | "workerTaskQueueUnavailable"
  | "workerTaskQueueUnavailableReason"
  | "historyError"
> {
  const classification = inspection.classification;
  const timeoutClassification = classification?.classification;
  const activityScheduleToStartTimeout =
    timeoutClassification === "activity" &&
    timeoutType === TimeoutType.SCHEDULE_TO_START &&
    classification?.activityScheduleToStartTimedOut === true;
  const workerTaskQueueReason =
    classification === undefined ||
    workflowType !== "agentTaskWorkflow" ||
    (timeoutClassification !== "workflow-task" &&
      timeoutClassification !== "execution" &&
      !activityScheduleToStartTimeout)
      ? undefined
      : activityScheduleToStartTimeout
        ? "a scheduled activity has not started"
        : workerTaskQueueUnavailableReason(classification);
  return {
    ...(classification === undefined
      ? {}
      : {
          timeoutClassification: classification.classification,
          ...(activityScheduleToStartTimeout
            ? { timeoutDispatchState: "pre-dispatch" as const }
            : {}),
          workerTaskQueueUnavailable: workerTaskQueueReason !== undefined,
          ...(workerTaskQueueReason === undefined
            ? {}
            : { workerTaskQueueUnavailableReason: workerTaskQueueReason }),
        }),
    ...(inspection.historyError === undefined
      ? {}
      : { historyError: inspection.historyError }),
  };
}

function workflowFailureDetail(
  error: WorkflowFailedError,
  execution: FailedWorkflowExecution,
  inspection: TimeoutInspection,
): WorkflowFailureDetail {
  const outerCause = error.cause;
  const cause =
    outerCause instanceof TemporalFailure
      ? innermostTemporalFailure(outerCause)
      : undefined;
  return {
    failureType:
      cause === undefined
        ? (outerCause?.name ?? "UnknownFailure")
        : failureTypeName(cause),
    message:
      cause === undefined
        ? (outerCause?.message ?? error.message)
        : cause.message === ""
          ? error.message
          : cause.message,
    stack: cause?.stack ?? outerCause?.stack,
    ...timeoutFailureFields(
      execution.workflowType,
      inspection,
      cause instanceof TimeoutFailure ? cause.timeoutType : undefined,
    ),
  };
}

async function fetchFailureDetail(
  client: WorkflowVisibilityClient,
  execution: FailedWorkflowExecution,
  rpcTimeoutMs: number,
): Promise<WorkflowFailureDetail> {
  const handle = client.workflow.getHandle(
    execution.workflowId,
    execution.runId,
  );
  try {
    await withWorkflowFailureRpcTimeout(
      handle.result(),
      "workflow-result",
      rpcTimeoutMs,
    );
    throw new Error(
      `workflow ${execution.workflowId}/${execution.runId} unexpectedly resolved while polling failures`,
    );
  } catch (error) {
    if (error instanceof WorkflowFailedError) {
      const temporalCause =
        error.cause instanceof TemporalFailure ? error.cause : undefined;
      const terminalCause =
        temporalCause === undefined
          ? undefined
          : innermostTemporalFailure(temporalCause);
      const shouldInspectTimeout =
        execution.status === "TIMED_OUT" ||
        terminalCause instanceof TimeoutFailure;
      const inspection = shouldInspectTimeout
        ? await inspectTimeoutHistory(handle, rpcTimeoutMs)
        : { classification: undefined, historyError: undefined };
      return workflowFailureDetail(error, execution, inspection);
    }
    throw error;
  }
}

export type BuildFailureAlertOptions = {
  now: Date;
  ttlMs: number;
  rpcTimeoutMs?: number;
};

export async function buildFailureAlertForExecution(
  client: WorkflowVisibilityClient,
  execution: FailedWorkflowExecution,
  options: BuildFailureAlertOptions,
): Promise<AlertmanagerAlert | undefined> {
  const rpcTimeoutMs =
    options.rpcTimeoutMs ?? DEFAULT_WORKFLOW_FAILURE_RPC_TIMEOUT_MS;
  try {
    const failure = await fetchFailureDetail(client, execution, rpcTimeoutMs);
    return buildWorkflowFailureAlert(
      execution,
      failure,
      options.now,
      options.ttlMs,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.withScope((scope) => {
      scope.setTag("component", COMPONENT);
      scope.setContext("workflowFailureWatch", {
        workflowId: execution.workflowId,
        runId: execution.runId,
        workflowType: execution.workflowType,
      });
      Sentry.captureException(error);
    });
    jsonLog(
      "warning",
      "failed to extract failure detail for execution; skipping",
      {
        workflowId: execution.workflowId,
        runId: execution.runId,
        workflowType: execution.workflowType,
        error: message,
      },
    );
    return undefined;
  }
}
