import type { AlertmanagerAlert } from "#lib/alertmanager.ts";

// Kept in sync manually with the Temporal Web UI Tailscale hostname
// documented in this package's CLAUDE.md (schedule pause instructions).
const TEMPORAL_UI_BASE_URL = "https://temporal-ui.tailnet-1a49.ts.net";

const MAX_SUMMARY_MESSAGE_CHARS = 200;
const MAX_STACK_EXCERPT_CHARS = 800;

export type FailedWorkflowExecution = {
  workflowId: string;
  runId: string;
  workflowType: string;
  taskQueue: string;
  closeTime: Date;
  /** Only the terminal statuses this watcher pages on — deliberate exclusion excludes cancel/terminate. */
  status: "FAILED" | "TIMED_OUT";
};

export type WorkerTaskQueueUnavailableReason =
  | "no activity reached execution"
  | "a scheduled activity has not started"
  | "a scheduled workflow task has not started";

export type WorkflowFailureDetail = {
  /** e.g. `ApplicationFailure`, `ActivityFailure`, `TimeoutFailure` — the TemporalFailure subclass name. */
  failureType: string;
  message: string;
  stack: string | undefined;
  timeoutClassification?:
    | "workflow-task"
    | "activity"
    | "execution"
    | "unknown";
  timeoutDispatchState?: "pre-dispatch" | "post-dispatch";
  workerTaskQueueUnavailable?: boolean;
  workerTaskQueueUnavailableReason?: WorkerTaskQueueUnavailableReason;
  historyError?: string;
};

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}…`;
}

/** Direct link to the failed run's history in the Temporal UI — not just "check the UI". */
export function temporalUiExecutionUrl(
  workflowId: string,
  runId: string,
): string {
  return `${TEMPORAL_UI_BASE_URL}/namespaces/default/workflows/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}/history`;
}

/**
 * Pure builder — no I/O. One `AlertmanagerAlert` per failed execution. Labels
 * (including workflowId/runId) are what Alertmanager uses to identify/dedup
 * the alert, so a poller re-observing the same execution across overlapping
 * lookback windows must produce byte-identical labels here, not just a
 * "similar" alert.
 */
export function buildWorkflowFailureAlert(
  execution: FailedWorkflowExecution,
  failure: WorkflowFailureDetail,
  now: Date,
  ttlMs: number,
): AlertmanagerAlert {
  const labels: Record<string, string> = {
    alertname: "TemporalWorkflowFailed",
    severity: "warning",
    workflowType: execution.workflowType,
    taskQueue: execution.taskQueue,
    workflowId: execution.workflowId,
    runId: execution.runId,
  };

  const summary = `Temporal workflow ${execution.workflowType} failed: ${failure.failureType}: ${truncate(failure.message, MAX_SUMMARY_MESSAGE_CHARS)}`;

  const descriptionParts = [
    `workflowId ${execution.workflowId}`,
    `runId ${execution.runId}`,
    `taskQueue ${execution.taskQueue}`,
    `status ${execution.status}`,
    `closeTime ${execution.closeTime.toISOString()}`,
    `failureType ${failure.failureType}`,
    `message ${failure.message}`,
  ];
  if (failure.stack !== undefined && failure.stack !== "") {
    descriptionParts.push(
      `stack ${truncate(failure.stack, MAX_STACK_EXCERPT_CHARS)}`,
    );
  }
  if (failure.timeoutClassification !== undefined) {
    descriptionParts.push(
      `timeoutClassification ${failure.timeoutClassification}`,
    );
  }
  if (failure.timeoutDispatchState !== undefined) {
    descriptionParts.push(
      `timeoutDispatchState ${failure.timeoutDispatchState}`,
    );
  }
  if (failure.workerTaskQueueUnavailable === true) {
    descriptionParts.push(
      `diagnosis worker/task-queue availability failure: ${failure.workerTaskQueueUnavailableReason ?? "no activity reached execution"}`,
    );
  }
  if (failure.historyError !== undefined) {
    descriptionParts.push(
      `historyError ${truncate(failure.historyError, 240)}`,
    );
  }
  const description = descriptionParts.join("\n");

  const startsAt = now.toISOString();
  // Keep the alert lifecycle tied to the execution rather than to the last
  // poll. Re-observing a failure during the lookback must not extend its
  // PagerDuty repeat/resolution window indefinitely.
  const endsAt = new Date(execution.closeTime.getTime() + ttlMs).toISOString();

  return {
    labels,
    // `message` mirrors `description` — the Alertmanager PagerDuty template
    // in prometheus.ts reads CommonAnnotations.message/description
    // interchangeably depending on the alert source (see xcode-cloud-webhook.ts).
    annotations: { summary, description, message: description },
    startsAt,
    endsAt,
    generatorURL: temporalUiExecutionUrl(execution.workflowId, execution.runId),
  };
}
