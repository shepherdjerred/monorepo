import { graphemePrefix } from "@shepherdjerred/text";
import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import type { TemporalNamespace } from "#shared/infra/temporal-namespace.ts";

// Kept in sync manually with the Temporal Web UI Tailscale hostname
// documented in this package's CLAUDE.md (schedule pause instructions).
const TEMPORAL_UI_BASE_URL = "https://temporal-ui.tailnet-1a49.ts.net";

const MAX_SUMMARY_MESSAGE_CHARS = 200;
const MAX_STACK_EXCERPT_CHARS = 800;
export const SCHEDULED_FAILURE_STABILITY_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCHEDULE_TIMESTAMP_SUFFIX_PATTERN =
  /-(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z|\d{10,13})$/u;
const SCHEDULE_WORKFLOW_INFIX = "-workflow";

export type WorkflowFailureScheduleRecovery = {
  /**
   * Close time of the failure that begins the candidate post-failure recovery
   * window (`>= execution.closeTime`). Defaults to `execution.closeTime`.
   */
  readonly windowStartCloseTime?: Date;
  /**
   * Earliest observed failure in this schedule / `(workflowType, taskQueue)`
   * slice with `closeTime > windowStartCloseTime`, or `undefined` when no later
   * failure occurred.
   */
  readonly nextFailureCloseTime?: Date;
  /**
   * Close time of a `Completed` execution of the schedule in
   * `(windowStartCloseTime, nextFailureCloseTime)` (or `> windowStartCloseTime`
   * when `nextFailureCloseTime` is `undefined`).
   */
  readonly completedCloseTime?: Date;
};

export type FailedWorkflowExecution = {
  temporalNamespace: TemporalNamespace;
  workflowId: string;
  runId: string;
  workflowType: string;
  taskQueue: string;
  /** Present when the execution belongs to a recurring Temporal Schedule. */
  scheduleId?: string;
  /** True when `scheduleId` came from `TemporalScheduledById` visibility attributes. */
  scheduledByAttribute?: boolean;
  /** Stability evidence evaluated before resolving a past scheduled failure early. */
  scheduleRecovery?: WorkflowFailureScheduleRecovery;
  /** Temporal visibility's stable descending pagination key. */
  startTime: Date;
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
    "workflow-task" | "activity" | "execution" | "unknown";
  timeoutDispatchState?: "pre-dispatch" | "post-dispatch";
  workerTaskQueueUnavailable?: boolean;
  workerTaskQueueUnavailableReason?: WorkerTaskQueueUnavailableReason;
  historyError?: string;
};

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${graphemePrefix(value, maxChars)}…`;
}

/** Direct link to the failed run's history in the Temporal UI — not just "check the UI". */
export function temporalUiExecutionUrl(
  namespace: TemporalNamespace,
  workflowId: string,
  runId: string,
): string {
  return `${TEMPORAL_UI_BASE_URL}/namespaces/${namespace}/workflows/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}/history`;
}

/**
 * Extracts a recurring schedule ID from Temporal's schedule-generated workflow ID
 * conventions (`<schedule>-workflow-<iso|epoch>` or `<schedule>-<iso|epoch>`).
 */
export function scheduleIdFromWorkflowId(
  workflowId: string,
): string | undefined {
  const match = SCHEDULE_TIMESTAMP_SUFFIX_PATTERN.exec(workflowId);
  if (match === null || match.index === 0) {
    return undefined;
  }
  const prefix = workflowId.slice(0, match.index);
  const candidate = prefix.endsWith(SCHEDULE_WORKFLOW_INFIX)
    ? prefix.slice(0, -SCHEDULE_WORKFLOW_INFIX.length)
    : prefix;
  return candidate === "" ? undefined : candidate;
}

/**
 * Monotonic stability gate for resolving past scheduled workflow failures
 * before the 24h TTL expires:
 *   a) execution belongs to a recurring schedule,
 *   b) a post-failure window `(windowStart, windowEnd]` (`windowStart >= closeTime`,
 *      `windowEnd = nextFailureCloseTime ?? now`) spans at least `stabilityWindowMs`
 *      with zero failures inside `(windowStart, windowEnd)`,
 *   c) at least one `Completed` execution of that schedule closed strictly after
 *      `windowStart` (and strictly before `nextFailureCloseTime` when present).
 *
 * Because a later failure after an already-qualified `>= 2h` recovery window only
 * caps `windowEnd` at `nextFailureCloseTime` (`>= windowStart + 2h`), an execution
 * that has earned early resolution stays resolved on later polls instead of
 * resurrecting inside the 24h visibility lookback.
 */
export function shouldResolveScheduledFailureEarly(
  execution: Pick<
    FailedWorkflowExecution,
    "workflowId" | "closeTime" | "scheduleId"
  >,
  recovery: WorkflowFailureScheduleRecovery | undefined,
  now: Date,
  stabilityWindowMs: number = SCHEDULED_FAILURE_STABILITY_WINDOW_MS,
): boolean {
  const scheduleId =
    execution.scheduleId ?? scheduleIdFromWorkflowId(execution.workflowId);
  if (scheduleId === undefined || recovery?.completedCloseTime === undefined) {
    return false;
  }
  const executionCloseMs = execution.closeTime.getTime();
  const windowStartMs = Math.max(
    executionCloseMs,
    recovery.windowStartCloseTime?.getTime() ?? executionCloseMs,
  );
  const nextFailureMs = recovery.nextFailureCloseTime?.getTime();
  if (nextFailureMs !== undefined && nextFailureMs <= windowStartMs) {
    return false;
  }
  const completedMs = recovery.completedCloseTime.getTime();
  const completedInWindow =
    completedMs > windowStartMs &&
    (nextFailureMs === undefined || completedMs < nextFailureMs);
  if (!completedInWindow) {
    return false;
  }
  const windowEndMs = nextFailureMs ?? now.getTime();
  return windowEndMs - windowStartMs >= stabilityWindowMs;
}

/**
 * Pure builder — no I/O. Recurring schedules collapse onto a stable
 * `schedule_id` label set (keeping the latest execution's `workflowId`/`runId`
 * in annotations), while ad-hoc executions retain `workflowId` and `runId` in
 * `labels` so distinct unscheduled failures remain independent. Every alert
 * stamps `exported_namespace` alongside `temporalNamespace` so Alertmanager
 * `inhibit_rules` can join directly against Prometheus series.
 */
export function buildWorkflowFailureAlert(
  execution: FailedWorkflowExecution,
  failure: WorkflowFailureDetail,
  now: Date,
  ttlMs: number,
): AlertmanagerAlert {
  const scheduleId =
    execution.scheduleId ?? scheduleIdFromWorkflowId(execution.workflowId);
  const labels: Record<string, string> =
    scheduleId === undefined
      ? {
          alertname: "TemporalWorkflowFailed",
          severity: "warning",
          workflowType: execution.workflowType,
          taskQueue: execution.taskQueue,
          temporalNamespace: execution.temporalNamespace,
          exported_namespace: execution.temporalNamespace,
          workflowId: execution.workflowId,
          runId: execution.runId,
        }
      : {
          alertname: "TemporalWorkflowFailed",
          severity: "warning",
          workflowType: execution.workflowType,
          taskQueue: execution.taskQueue,
          temporalNamespace: execution.temporalNamespace,
          exported_namespace: execution.temporalNamespace,
          schedule_id: scheduleId,
        };

  const summary = `Temporal workflow ${execution.workflowType} failed: ${failure.failureType}: ${truncate(failure.message, MAX_SUMMARY_MESSAGE_CHARS)}`;

  const descriptionParts = [
    `workflowId ${execution.workflowId}`,
    `runId ${execution.runId}`,
    `taskQueue ${execution.taskQueue}`,
    `temporalNamespace ${execution.temporalNamespace}`,
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
  // poll unless a recurring schedule has completed a newer run and remained
  // failure-free across the full 2h stability window.
  const endsAt = shouldResolveScheduledFailureEarly(
    execution,
    execution.scheduleRecovery,
    now,
  )
    ? now.toISOString()
    : new Date(execution.closeTime.getTime() + ttlMs).toISOString();

  const annotations: Record<string, string> =
    scheduleId === undefined
      ? { summary, description, message: description }
      : {
          summary,
          description,
          message: description,
          workflowId: execution.workflowId,
          runId: execution.runId,
        };

  return {
    labels,
    // `message` mirrors `description` — the Alertmanager Alerts template
    // in prometheus.ts reads CommonAnnotations.message/description
    // interchangeably depending on the alert source (see xcode-cloud-webhook.ts).
    annotations,
    startsAt,
    endsAt,
    generatorURL: temporalUiExecutionUrl(
      execution.temporalNamespace,
      execution.workflowId,
      execution.runId,
    ),
  };
}
