import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { WorkflowFailedError } from "@temporalio/client";
import { ApplicationFailure, TemporalFailure } from "@temporalio/common";
import { z } from "zod/v4";
import { createTemporalClient } from "#client";
import {
  type AlertmanagerAlert,
  type AlertPoster,
  createAlertmanagerPoster,
} from "#lib/alertmanager.ts";
import {
  buildWorkflowFailureAlert,
  type FailedWorkflowExecution,
  type WorkflowFailureDetail,
} from "#shared/workflow-failure-alert.ts";
import { temporalFailureWatcherAlertsTotal } from "#observability/metrics.ts";

/**
 * Polls the Temporal visibility API for workflow executions that closed as
 * Failed/TimedOut in the lookback window, extracts each execution's
 * structured failure via `handle.result()`, and posts one detail-rich alert
 * per execution to Alertmanager (which already routes to PagerDuty — see
 * `packages/homelab/.../argo-applications/prometheus.ts`). Stateless: no
 * checkpoint is persisted between polls, matching `observe-review-signals.ts`.
 * Safe to overlap polls because Alertmanager dedups by label set (identity =
 * alertname + workflowType + taskQueue + workflowId + runId).
 */

const COMPONENT = "temporal-failure-watch";
const HEARTBEAT_INTERVAL_MS = 10_000;

// Keep a full day of terminal executions queryable so a worker outage can be
// recovered by the next poll. The alert TTL matches this window, preventing a
// recovered poll from re-paging an execution that was already observed.
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// Matches XCODE_CLOUD_ALERT_TTL_SECONDS's rationale (xcode-cloud-webhook.ts):
// keeps a failure visible across the recovery window without lingering forever
// if polling stops re-observing it (there's no "next success" signal to
// resolve a specific past failure early, unlike the Xcode Cloud build-outcome
// case).
const DEFAULT_ALERT_TTL_SECONDS = 24 * 60 * 60;

const FAILURE_STATUS_NAMES = ["FAILED", "TIMED_OUT"] as const;
type FailureStatusName = (typeof FAILURE_STATUS_NAMES)[number];

export type PollWorkflowFailuresResult = {
  scanned: number;
  alerted: number;
  errored: number;
};

/** Narrow structural slice of `Client["workflow"]` — real client and test fakes both satisfy it. */
export type WorkflowVisibilityClient = {
  workflow: {
    list: (options: { query: string }) => AsyncIterable<{
      workflowId: string;
      runId: string;
      type: string;
      taskQueue: string;
      closeTime?: Date;
      status: { name: string };
    }>;
    getHandle: (
      workflowId: string,
      runId: string,
    ) => {
      result: () => Promise<unknown>;
      fetchHistory: () => Promise<unknown>;
    };
  };
};

export type WorkflowTimeoutClassification =
  | "workflow-task"
  | "activity"
  | "execution"
  | "unknown";

type WorkflowTimeoutHistoryClassification = {
  classification: WorkflowTimeoutClassification;
  activityScheduled: boolean;
  activityStarted: boolean;
  activityScheduledButNotStarted: boolean;
};

function eventRecord(event: unknown): Record<string, unknown> | undefined {
  if (typeof event !== "object" || event === null) {
    return undefined;
  }
  return z.record(z.string(), z.unknown()).parse(event);
}

function eventId(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return undefined;
}

function startedActivityScheduledEventId(event: unknown): string | undefined {
  const record = eventRecord(event);
  if (record === undefined) {
    return undefined;
  }
  const attributes =
    record["activityTaskStartedEventAttributes"] ??
    record["activity_task_started_event_attributes"];
  const attributesRecord = eventRecord(attributes);
  return attributesRecord === undefined
    ? undefined
    : eventId(
        attributesRecord["scheduledEventId"] ??
          attributesRecord["scheduled_event_id"],
      );
}

function historyEvents(history: unknown): readonly unknown[] {
  if (Array.isArray(history)) {
    return history;
  }
  if (typeof history !== "object" || history === null) {
    return [];
  }
  const record = z.record(z.string(), z.unknown()).parse(history);
  const events = record["events"];
  return Array.isArray(events) ? events : [];
}

function eventTypeName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
  }
  if (typeof value !== "number") {
    return undefined;
  }
  // These are the stable Temporal HistoryEvent enum values used by
  // @temporalio/client's fetchHistory() protobuf objects.
  switch (value) {
    case 4:
      return "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT";
    case 8:
      return "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT";
    case 10:
      return "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED";
    case 11:
      return "EVENT_TYPE_ACTIVITY_TASK_STARTED";
    case 14:
      return "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT";
    default:
      return undefined;
  }
}

function eventType(event: unknown): unknown {
  const record = eventRecord(event);
  return record?.["eventType"] ?? record?.["event_type"];
}

export function classifyWorkflowTimeoutHistory(
  history: unknown,
): WorkflowTimeoutHistoryClassification {
  let activityScheduled = false;
  let activityStarted = false;
  const scheduledActivityEventIds = new Set<string>();
  const startedActivityScheduledEventIds = new Set<string>();
  let latestTimeout: WorkflowTimeoutClassification | undefined;
  for (const event of historyEvents(history)) {
    const name = eventTypeName(eventType(event));
    if (name === undefined) {
      continue;
    }
    if (name === "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED") {
      activityScheduled = true;
      const id = eventId(eventRecord(event)?.["eventId"]);
      if (id !== undefined) {
        scheduledActivityEventIds.add(id);
      }
    }
    if (name === "EVENT_TYPE_ACTIVITY_TASK_STARTED") {
      activityStarted = true;
      const scheduledEventId = startedActivityScheduledEventId(event);
      if (scheduledEventId !== undefined) {
        startedActivityScheduledEventIds.add(scheduledEventId);
      }
    }
    switch (name) {
      case "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT":
        latestTimeout = "workflow-task";
        break;
      case "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT":
        latestTimeout = "activity";
        break;
      case "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT":
        latestTimeout = "execution";
        break;
    }
  }
  return {
    classification: latestTimeout ?? "unknown",
    activityScheduled,
    activityStarted,
    activityScheduledButNotStarted: [...scheduledActivityEventIds].some(
      (id) => !startedActivityScheduledEventIds.has(id),
    ),
  };
}

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readTtlMs(): number {
  const raw = Bun.env["TEMPORAL_FAILURE_ALERT_TTL_SECONDS"];
  if (raw === undefined || raw === "") {
    return DEFAULT_ALERT_TTL_SECONDS * 1000;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `TEMPORAL_FAILURE_ALERT_TTL_SECONDS must be a positive integer, got ${raw}`,
    );
  }
  return parsed * 1000;
}

function toFailureStatusName(name: string): FailureStatusName | undefined {
  return FAILURE_STATUS_NAMES.find((candidate) => candidate === name);
}

export function buildVisibilityQuery(since: Date): string {
  return `ExecutionStatus IN ("Failed", "TimedOut") AND CloseTime > "${since.toISOString()}"`;
}

/**
 * Walks the Temporal failure chain to its innermost `TemporalFailure`. When a
 * workflow fails because a proxied activity threw, `WorkflowFailedError.cause`
 * is an `ActivityFailure` whose message is only a generic "Activity task
 * failed"; the specific `ApplicationFailure` that actually explains the failure
 * is nested at `.cause.cause` (see `workflows/glitter-context-refresh.test.ts`).
 * Descending to the deepest TemporalFailure yields the real type/message/stack
 * the Temporal UI shows, for every workflow — not just those that fail inline.
 */
function innermostTemporalFailure(failure: TemporalFailure): TemporalFailure {
  let current = failure;
  while (current.cause instanceof TemporalFailure) {
    current = current.cause;
  }
  return current;
}

/**
 * The failure "type" the Temporal UI shows. For an `ApplicationFailure` that is
 * its custom `type` (e.g. `BilledGenerationFinalizationError`), not the generic
 * class name `ApplicationFailure`; every other TemporalFailure subclass uses its
 * class name (`TimeoutFailure`, `ActivityFailure`, ...).
 */
function failureTypeName(failure: TemporalFailure): string {
  if (
    failure instanceof ApplicationFailure &&
    failure.type !== undefined &&
    failure.type !== null &&
    failure.type !== ""
  ) {
    return failure.type;
  }
  return failure.name;
}

/**
 * Extracts the structured failure from a closed Failed/TimedOut execution.
 * `handle.result()` on an already-closed execution rejects immediately (no
 * blocking) with `WorkflowFailedError`, whose `.cause` is the TemporalFailure
 * subclass (ApplicationFailure/ActivityFailure/TimeoutFailure/...) carrying
 * the same type/message/stack the Temporal UI shows.
 */
type TimeoutInspection = {
  classification: WorkflowTimeoutHistoryClassification | undefined;
  historyError: string | undefined;
};

async function inspectTimeoutHistory(
  handle: ReturnType<WorkflowVisibilityClient["workflow"]["getHandle"]>,
  status: FailureStatusName,
): Promise<TimeoutInspection> {
  if (status !== "TIMED_OUT") {
    return { classification: undefined, historyError: undefined };
  }
  try {
    return {
      classification: classifyWorkflowTimeoutHistory(
        await handle.fetchHistory(),
      ),
      historyError: undefined,
    };
  } catch (error: unknown) {
    return {
      classification: {
        classification: "unknown",
        activityScheduled: false,
        activityStarted: false,
        activityScheduledButNotStarted: false,
      },
      historyError: error instanceof Error ? error.message : String(error),
    };
  }
}

function timeoutFailureFields(
  workflowType: string,
  inspection: TimeoutInspection,
): Pick<
  WorkflowFailureDetail,
  "timeoutClassification" | "workerTaskQueueUnavailable" | "historyError"
> {
  const classification = inspection.classification;
  return {
    ...(classification === undefined
      ? {}
      : {
          timeoutClassification: classification.classification,
          workerTaskQueueUnavailable:
            workflowType === "agentTaskWorkflow" &&
            (!classification.activityStarted ||
              classification.activityScheduledButNotStarted) &&
            (classification.classification === "workflow-task" ||
              classification.classification === "execution"),
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
    ...timeoutFailureFields(execution.workflowType, inspection),
  };
}

async function fetchFailureDetail(
  client: WorkflowVisibilityClient,
  execution: FailedWorkflowExecution,
): Promise<WorkflowFailureDetail> {
  const handle = client.workflow.getHandle(
    execution.workflowId,
    execution.runId,
  );
  const inspection = await inspectTimeoutHistory(handle, execution.status);
  try {
    await handle.result();
    // The visibility query already filtered to Failed/TimedOut, so a
    // resolved result() here means the execution's terminal state changed
    // between list() and this call (or the query matched unexpectedly) —
    // surface it as a detail-extraction failure rather than silently
    // skipping, so it's visible in Sentry.
    throw new Error(
      `workflow ${execution.workflowId}/${execution.runId} unexpectedly resolved while polling failures`,
    );
  } catch (error) {
    if (error instanceof WorkflowFailedError) {
      return workflowFailureDetail(error, execution, inspection);
    }
    throw error;
  }
}

export type PollWorkflowFailuresOptions = {
  now: Date;
  lookbackMs: number;
  ttlMs: number;
};

/**
 * One poll cycle. Injectable client/poster/clock for tests; the real
 * activity below supplies the live Temporal client, the Alertmanager HTTP
 * poster, and `new Date()`.
 */
export async function pollWorkflowFailuresOnce(
  client: WorkflowVisibilityClient,
  poster: AlertPoster,
  options: PollWorkflowFailuresOptions,
): Promise<PollWorkflowFailuresResult> {
  const { now, lookbackMs, ttlMs } = options;
  const since = new Date(now.getTime() - lookbackMs);
  const query = buildVisibilityQuery(since);

  const executions: FailedWorkflowExecution[] = [];
  for await (const info of client.workflow.list({ query })) {
    const status = toFailureStatusName(info.status.name);
    if (status === undefined || info.closeTime === undefined) {
      continue;
    }
    executions.push({
      workflowId: info.workflowId,
      runId: info.runId,
      workflowType: info.type,
      taskQueue: info.taskQueue,
      closeTime: info.closeTime,
      status,
    });
  }

  const alerts: AlertmanagerAlert[] = [];
  let errored = 0;
  for (const execution of executions) {
    try {
      const failure = await fetchFailureDetail(client, execution);
      alerts.push(buildWorkflowFailureAlert(execution, failure, now, ttlMs));
    } catch (error) {
      errored += 1;
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
    }
  }

  // Isolated per-execution detail-extraction failures are tolerated, but if
  // EVERY execution in a non-empty batch failed, the cause is systematic
  // (e.g. the Temporal server rejected result() calls broadly) — throw so
  // Temporal retries instead of silently reporting a clean poll that alerted
  // on nothing.
  if (executions.length > 0 && alerts.length === 0) {
    throw new Error(
      `workflow-failure-watch found ${String(executions.length)} failed execution(s) but could not extract detail for any of them (${String(errored)} errored); treating as a systematic failure so Temporal retries.`,
    );
  }

  if (alerts.length > 0) {
    await poster(alerts);
    // Recorded after the poster succeeds, mirroring observe-review-signals.ts —
    // an activity retry after a failed post re-alerts (safe: Alertmanager
    // dedups by label) but this counter is informational only, not exactly-once.
    for (const alert of alerts) {
      temporalFailureWatcherAlertsTotal.inc({
        workflowType: alert.labels["workflowType"] ?? "unknown",
      });
    }
  }

  jsonLog("info", "workflow-failure-watch poll complete", {
    scanned: executions.length,
    alerted: alerts.length,
    errored,
  });

  return { scanned: executions.length, alerted: alerts.length, errored };
}

async function runPollWorkflowFailuresImpl(): Promise<PollWorkflowFailuresResult> {
  const client = await createTemporalClient();
  const poster = createAlertmanagerPoster(requiredEnv("ALERTMANAGER_URL"));
  return pollWorkflowFailuresOnce(client, poster, {
    now: new Date(),
    lookbackMs: DEFAULT_LOOKBACK_MS,
    ttlMs: readTtlMs(),
  });
}

export type WorkflowFailureWatchActivities =
  typeof workflowFailureWatchActivities;

export const workflowFailureWatchActivities = {
  async pollWorkflowFailures(): Promise<PollWorkflowFailuresResult> {
    const start = Date.now();
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "pollWorkflowFailures",
        elapsedMs: Date.now() - start,
      });
    }, HEARTBEAT_INTERVAL_MS);
    try {
      return await runPollWorkflowFailuresImpl();
    } finally {
      clearInterval(heartbeat);
    }
  },
};
