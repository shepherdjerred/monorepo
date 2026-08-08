import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { WorkflowFailedError } from "@temporalio/client";
import {
  ApplicationFailure,
  TemporalFailure,
  TimeoutFailure,
  TimeoutType,
} from "@temporalio/common";
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
import {
  classifyWorkflowTimeoutHistory,
  type WorkflowTimeoutHistoryClassification,
} from "./workflow-failure-history.ts";

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
// recovered by the next poll. The alert TTL covers this window plus delivery
// margin, preventing a recovered poll from re-paging an execution that was
// already observed while leaving Alertmanager time to notify PagerDuty.
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Leave enough time for Alertmanager's grouping and notification delays after
// the final recovery poll can still observe the oldest execution.
const ALERT_DELIVERY_MARGIN_MS = 5 * 60 * 1000;

// Matches XCODE_CLOUD_ALERT_TTL_SECONDS's rationale (xcode-cloud-webhook.ts):
// keeps a failure visible across the recovery window without lingering forever
// if polling stops re-observing it (there's no "next success" signal to
// resolve a specific past failure early, unlike the Xcode Cloud build-outcome
// case).
const DEFAULT_ALERT_TTL_SECONDS =
  (DEFAULT_LOOKBACK_MS + ALERT_DELIVERY_MARGIN_MS) / 1000;

// Bound recovery work so the 24-hour visibility window cannot turn into one
// serial activity that exhausts its deadline before posting any alerts.
const FAILURE_DETAIL_CONCURRENCY = 16;
const ALERT_BATCH_SIZE = 25;

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

export function parseAlertTtlMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_ALERT_TTL_SECONDS * 1000;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `TEMPORAL_FAILURE_ALERT_TTL_SECONDS must be a positive integer, got ${raw}`,
    );
  }
  const ttlMs = parsed * 1000;
  const minimumTtlMs = DEFAULT_LOOKBACK_MS + ALERT_DELIVERY_MARGIN_MS;
  if (ttlMs < minimumTtlMs) {
    throw new Error(
      `TEMPORAL_FAILURE_ALERT_TTL_SECONDS must be at least ${String(minimumTtlMs / 1000)} to cover the recovery lookback and alert delivery margin, got ${raw}`,
    );
  }
  return ttlMs;
}

function readTtlMs(): number {
  return parseAlertTtlMs(Bun.env["TEMPORAL_FAILURE_ALERT_TTL_SECONDS"]);
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

function containsTimeoutFailure(failure: TemporalFailure): boolean {
  let current: TemporalFailure | undefined = failure;
  while (current !== undefined) {
    if (current instanceof TimeoutFailure) {
      return true;
    }
    const nestedCause: Error | undefined = current.cause;
    current = nestedCause instanceof TemporalFailure ? nestedCause : undefined;
  }
  return false;
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
): Promise<TimeoutInspection> {
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
        workflowTaskScheduled: false,
        workflowTaskStarted: false,
        workflowTaskScheduledButNotStarted: false,
        activityScheduled: false,
        activityStarted: false,
        activityScheduledButNotStarted: false,
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
  if (!classification.workflowTaskStarted && !classification.activityStarted) {
    return "no activity reached execution";
  }
  return undefined;
}

function timeoutFailureFields(
  workflowType: string,
  inspection: TimeoutInspection,
  timeoutType: TimeoutType | undefined,
): Pick<
  WorkflowFailureDetail,
  | "timeoutClassification"
  | "workerTaskQueueUnavailable"
  | "workerTaskQueueUnavailableReason"
  | "historyError"
> {
  const classification = inspection.classification;
  const timeoutClassification = classification?.classification;
  const activityScheduleToStartTimeout =
    timeoutClassification === "activity" &&
    timeoutType === TimeoutType.SCHEDULE_TO_START &&
    classification?.activityScheduledButNotStarted === true;
  const workerTaskQueueReason =
    classification === undefined ||
    workflowType !== "agentTaskWorkflow" ||
    (timeoutClassification !== "workflow-task" &&
      timeoutClassification !== "execution" &&
      !activityScheduleToStartTimeout)
      ? undefined
      : workerTaskQueueUnavailableReason(classification);
  return {
    ...(classification === undefined
      ? {}
      : {
          timeoutClassification: classification.classification,
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
): Promise<WorkflowFailureDetail> {
  const handle = client.workflow.getHandle(
    execution.workflowId,
    execution.runId,
  );
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
      const temporalCause =
        error.cause instanceof TemporalFailure ? error.cause : undefined;
      const shouldInspectTimeout =
        execution.status === "TIMED_OUT" ||
        (temporalCause !== undefined && containsTimeoutFailure(temporalCause));
      const inspection = shouldInspectTimeout
        ? await inspectTimeoutHistory(handle)
        : { classification: undefined, historyError: undefined };
      return workflowFailureDetail(error, execution, inspection);
    }
    throw error;
  }
}

async function buildFailureAlertForExecution(
  client: WorkflowVisibilityClient,
  execution: FailedWorkflowExecution,
  now: Date,
  ttlMs: number,
): Promise<AlertmanagerAlert | undefined> {
  try {
    const failure = await fetchFailureDetail(client, execution);
    return buildWorkflowFailureAlert(execution, failure, now, ttlMs);
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

type FailureBatchResult = {
  alerted: number;
  errored: number;
};

async function postFailureBatch(
  client: WorkflowVisibilityClient,
  poster: AlertPoster,
  executions: readonly FailedWorkflowExecution[],
  options: PollWorkflowFailuresOptions,
): Promise<FailureBatchResult> {
  const { now, ttlMs } = options;
  const alerts: AlertmanagerAlert[] = [];
  let errored = 0;
  for (
    let chunkStart = 0;
    chunkStart < executions.length;
    chunkStart += FAILURE_DETAIL_CONCURRENCY
  ) {
    const chunk = executions.slice(
      chunkStart,
      chunkStart + FAILURE_DETAIL_CONCURRENCY,
    );
    const chunkAlerts = await Promise.all(
      chunk.map((execution) =>
        buildFailureAlertForExecution(client, execution, now, ttlMs),
      ),
    );
    for (const alert of chunkAlerts) {
      if (alert === undefined) {
        errored += 1;
      } else {
        alerts.push(alert);
      }
    }
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

  return { alerted: alerts.length, errored };
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
  const { now, lookbackMs } = options;
  const since = new Date(now.getTime() - lookbackMs);
  const query = buildVisibilityQuery(since);

  const pendingExecutions: FailedWorkflowExecution[] = [];
  let scanned = 0;
  let errored = 0;
  let alerted = 0;
  for await (const info of client.workflow.list({ query })) {
    const status = toFailureStatusName(info.status.name);
    if (status === undefined || info.closeTime === undefined) {
      continue;
    }
    pendingExecutions.push({
      workflowId: info.workflowId,
      runId: info.runId,
      workflowType: info.type,
      taskQueue: info.taskQueue,
      closeTime: info.closeTime,
      status,
    });
    scanned += 1;
    if (pendingExecutions.length === ALERT_BATCH_SIZE) {
      const result = await postFailureBatch(
        client,
        poster,
        pendingExecutions,
        options,
      );
      alerted += result.alerted;
      errored += result.errored;
      pendingExecutions.length = 0;
    }
  }

  if (pendingExecutions.length > 0) {
    const result = await postFailureBatch(
      client,
      poster,
      pendingExecutions,
      options,
    );
    alerted += result.alerted;
    errored += result.errored;
  }

  // Isolated per-execution detail-extraction failures are tolerated, but if
  // EVERY execution in a non-empty batch failed, the cause is systematic
  // (e.g. the Temporal server rejected result() calls broadly) — throw so
  // Temporal retries instead of silently reporting a clean poll that alerted
  // on nothing.
  if (alerted === 0 && scanned > 0) {
    throw new Error(
      `workflow-failure-watch found ${String(scanned)} failed execution(s) but could not extract detail for any of them (${String(errored)} errored); treating as a systematic failure so Temporal retries.`,
    );
  }

  jsonLog("info", "workflow-failure-watch poll complete", {
    scanned,
    alerted,
    errored,
  });

  return { scanned, alerted, errored };
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
