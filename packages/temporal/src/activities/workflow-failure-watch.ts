import { type AlertmanagerAlert, type AlertPoster } from "#lib/alertmanager.ts";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";
import { temporalFailureWatcherAlertsTotal } from "#observability/metrics.ts";
import {
  checkpointForExecution,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";
import { buildFailureAlertForExecution } from "./workflow-failure-watch-detail.ts";

/**
 * Polls the Temporal visibility API for workflow executions that closed as
 * Failed/TimedOut in the lookback window, extracts each execution's
 * structured failure via `handle.result()`, and posts one detail-rich alert
 * per execution to Alertmanager (which already routes to PagerDuty — see
 * `packages/homelab/.../argo-applications/prometheus.ts`). Each successful
 * detail batch heartbeats its last item. A retry scans the full lookback and
 * applies a conservative in-memory checkpoint because the public visibility
 * iterator does not expose a precision-safe page token. Safe to overlap
 * polls because Alertmanager dedups by label set
 * (identity = alertname + workflowType + taskQueue + workflowId + runId).
 */

const COMPONENT = "temporal-failure-watch";
// Keep a full day of terminal executions queryable so a worker outage can be
// recovered by the next poll. The alert TTL covers this window plus delivery
// margin, preventing a recovered poll from re-paging an execution that was
// already observed while leaving Alertmanager time to notify PagerDuty.
export const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// The activity may consume all three attempts before it can finish the
// visibility scan. Keep the original close-time boundary alive through that
// retry budget, then leave a separate margin for Alertmanager grouping and
// notification.
const ACTIVITY_START_TO_CLOSE_TIMEOUT_MS = 2 * 60 * 1000;
const ACTIVITY_MAX_ATTEMPTS = 3;
const ACTIVITY_RETRY_BACKOFF_MS = (10 + 20) * 1000;
const ACTIVITY_RETRY_BUDGET_MS =
  ACTIVITY_MAX_ATTEMPTS * ACTIVITY_START_TO_CLOSE_TIMEOUT_MS +
  ACTIVITY_RETRY_BACKOFF_MS;
const ALERT_DELIVERY_MARGIN_MS = 5 * 60 * 1000;

// Matches XCODE_CLOUD_ALERT_TTL_SECONDS's rationale (xcode-cloud-webhook.ts):
// keeps a failure visible across the recovery window without lingering forever
// if polling stops re-observing it (there's no "next success" signal to
// resolve a specific past failure early, unlike the Xcode Cloud build-outcome
// case).
const DEFAULT_ALERT_TTL_SECONDS =
  (DEFAULT_LOOKBACK_MS + ACTIVITY_RETRY_BUDGET_MS + ALERT_DELIVERY_MARGIN_MS) /
  1000;

// Bound recovery work so the 24-hour visibility window cannot turn into one
// serial activity that exhausts its deadline before posting any alerts.
const FAILURE_DETAIL_CONCURRENCY = 16;
const ALERT_BATCH_SIZE = 25;
const VISIBILITY_PAGE_SIZE = 100;

const FAILURE_STATUS_NAMES = ["FAILED", "TIMED_OUT"] as const;
type FailureStatusName = (typeof FAILURE_STATUS_NAMES)[number];

// Temporal visibility pages are newest-first. The SQL store's page token uses
// CloseTime DESC, StartTime DESC, RunId ASC as its continuation boundary; the
// cursor query and in-memory comparator below intentionally mirror that order.
export type PollWorkflowFailuresResult = {
  scanned: number;
  alerted: number;
  errored: number;
};

/** Narrow structural slice of `Client["workflow"]` — real client and test fakes both satisfy it. */
export type WorkflowVisibilityClient = {
  workflow: {
    list: (options: { query: string; pageSize?: number }) => AsyncIterable<{
      workflowId: string;
      runId: string;
      type: string;
      taskQueue: string;
      startTime: Date;
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

export function requiredEnv(name: string): string {
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
  const minimumTtlMs =
    DEFAULT_LOOKBACK_MS + ACTIVITY_RETRY_BUDGET_MS + ALERT_DELIVERY_MARGIN_MS;
  if (ttlMs < minimumTtlMs) {
    throw new Error(
      `TEMPORAL_FAILURE_ALERT_TTL_SECONDS must be at least ${String(minimumTtlMs / 1000)} to cover the recovery lookback, activity retry budget, and alert delivery margin, got ${raw}`,
    );
  }
  return ttlMs;
}

export function readTtlMs(): number {
  return parseAlertTtlMs(Bun.env["TEMPORAL_FAILURE_ALERT_TTL_SECONDS"]);
}

function toFailureStatusName(name: string): FailureStatusName | undefined {
  return FAILURE_STATUS_NAMES.find((candidate) => candidate === name);
}

export function buildVisibilityQuery(since: Date): string {
  return [
    'ExecutionStatus IN ("Failed", "TimedOut")',
    `CloseTime > "${since.toISOString()}"`,
  ].join(" AND ");
}

function pollVisibilityBoundary(
  options: Pick<
    PollWorkflowFailuresOptions,
    "now" | "lookbackMs" | "lookbackSince" | "checkpoint"
  >,
): { since: Date; query: string } {
  const since =
    options.lookbackSince ??
    options.checkpoint?.lookbackSince ??
    new Date(options.now.getTime() - options.lookbackMs);
  return { since, query: buildVisibilityQuery(since) };
}

function isAfterCheckpoint(
  closeTime: Date,
  checkpoint: WorkflowFailureWatchCheckpoint,
): boolean {
  if (closeTime.getTime() < checkpoint.closeTime.getTime()) {
    return true;
  }
  if (closeTime.getTime() > checkpoint.closeTime.getTime()) {
    return false;
  }
  // Temporal's public AsyncIterable does not expose its visibility page token,
  // and WorkflowExecutionInfo dates are only millisecond precision. Keep the
  // full lookback query and conservatively retain every execution in the same
  // millisecond as the checkpoint; duplicate Alertmanager labels are harmless,
  // while skipping one would lose a production page.
  return true;
}

type FailureDetailResult = {
  alerted: number;
  errored: number;
};

type FailureBatchResult = FailureDetailResult & {
  checkpointBlocked: boolean;
};

type CheckpointProgressOptions = {
  checkpointBlocked: boolean;
  lookbackSince: Date;
  onCheckpoint:
    | ((checkpoint: WorkflowFailureWatchCheckpoint) => void)
    | undefined;
};

type PostFailureBatchOptions = {
  client: WorkflowVisibilityClient;
  poster: AlertPoster;
  executions: readonly FailedWorkflowExecution[];
  options: PollWorkflowFailuresOptions;
  checkpointProgress: CheckpointProgressOptions;
};

type PostFailureBatchInput = {
  client: WorkflowVisibilityClient;
  poster: AlertPoster;
  executions: readonly FailedWorkflowExecution[];
  pollOptions: PollWorkflowFailuresOptions;
  checkpointBlocked: boolean;
  lookbackSince: Date;
};

function postFailureBatchOptions(
  input: PostFailureBatchInput,
): PostFailureBatchOptions {
  return {
    client: input.client,
    poster: input.poster,
    executions: input.executions,
    options: input.pollOptions,
    checkpointProgress: {
      checkpointBlocked: input.checkpointBlocked,
      lookbackSince: input.lookbackSince,
      onCheckpoint: input.pollOptions.onCheckpoint,
    },
  };
}

async function postFailureBatch(
  batchOptions: PostFailureBatchOptions,
): Promise<FailureBatchResult> {
  const { client, poster, executions, options, checkpointProgress } =
    batchOptions;
  const { now, ttlMs } = options;
  const alerts: AlertmanagerAlert[] = [];
  let errored = 0;
  let checkpointBlocked = checkpointProgress.checkpointBlocked;
  for (
    let chunkStart = 0;
    chunkStart < executions.length;
    chunkStart += FAILURE_DETAIL_CONCURRENCY
  ) {
    const chunk = executions.slice(
      chunkStart,
      chunkStart + FAILURE_DETAIL_CONCURRENCY,
    );
    let chunkErrored = 0;
    const chunkAlerts = await Promise.all(
      chunk.map((execution) =>
        buildFailureAlertForExecution(client, execution, now, ttlMs),
      ),
    );
    const postedAlerts: AlertmanagerAlert[] = [];
    for (const alert of chunkAlerts) {
      if (alert === undefined) {
        chunkErrored += 1;
        errored += 1;
      } else {
        alerts.push(alert);
        postedAlerts.push(alert);
      }
    }

    if (postedAlerts.length > 0) {
      await poster(postedAlerts);
      // Recorded after the poster succeeds, mirroring observe-review-signals.ts
      // — an activity retry after a failed post re-alerts (safe: Alertmanager
      // dedups by label) but this counter is informational only, not exactly-once.
      for (const alert of postedAlerts) {
        temporalFailureWatcherAlertsTotal.inc({
          workflowType: alert.labels["workflowType"] ?? "unknown",
        });
      }
    }

    // Persist progress after each successfully posted detail chunk, rather
    // than waiting for the whole visibility batch. If a later detail RPC or
    // the visibility iterator exhausts this activity attempt, the retry can
    // resume below this cursor instead of replaying only the prefix forever.
    const chunkResult = {
      alerted: chunkAlerts.length - chunkErrored,
      errored: chunkErrored,
    };
    checkpointBlocked = advanceRecoveryCheckpoint(
      chunkResult,
      chunk,
      checkpointBlocked,
      checkpointProgress,
    );
  }

  return { alerted: alerts.length, errored, checkpointBlocked };
}

function advanceRecoveryCheckpoint(
  result: FailureDetailResult,
  executions: readonly FailedWorkflowExecution[],
  checkpointBlocked: boolean,
  checkpointOptions: {
    onCheckpoint:
      | ((checkpoint: WorkflowFailureWatchCheckpoint) => void)
      | undefined;
    lookbackSince: Date;
  },
): boolean {
  if (result.errored !== 0) {
    return true;
  }
  if (checkpointBlocked || checkpointOptions.onCheckpoint === undefined) {
    return checkpointBlocked;
  }
  const lastExecution = executions.at(-1);
  if (lastExecution !== undefined) {
    checkpointOptions.onCheckpoint(
      checkpointForExecution(lastExecution, checkpointOptions.lookbackSince),
    );
  }
  return false;
}

export type PollWorkflowFailuresOptions = {
  now: Date;
  lookbackMs: number;
  ttlMs: number;
  lookbackSince?: Date;
  checkpoint?: WorkflowFailureWatchCheckpoint;
  onCheckpoint?: (checkpoint: WorkflowFailureWatchCheckpoint) => void;
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
  const { checkpoint } = options;
  const { since, query } = pollVisibilityBoundary(options);

  const pendingExecutions: FailedWorkflowExecution[] = [];
  let scanned = 0;
  let errored = 0;
  let alerted = 0;
  let listingFailed = false;
  let listingError: unknown;
  let processingBatch = false;
  let checkpointBlocked = false;
  try {
    for await (const info of client.workflow.list({
      query,
      pageSize: VISIBILITY_PAGE_SIZE,
    })) {
      const status = toFailureStatusName(info.status.name);
      if (status === undefined || info.closeTime === undefined) {
        continue;
      }
      if (
        checkpoint !== undefined &&
        !isAfterCheckpoint(info.closeTime, checkpoint)
      ) {
        continue;
      }
      pendingExecutions.push({
        workflowId: info.workflowId,
        runId: info.runId,
        workflowType: info.type,
        taskQueue: info.taskQueue,
        startTime: info.startTime,
        closeTime: info.closeTime,
        status,
      });
      scanned += 1;
      if (pendingExecutions.length === ALERT_BATCH_SIZE) {
        processingBatch = true;
        const result = await postFailureBatch(
          postFailureBatchOptions({
            client,
            poster,
            executions: pendingExecutions,
            pollOptions: options,
            checkpointBlocked,
            lookbackSince: since,
          }),
        );
        checkpointBlocked = result.checkpointBlocked;
        processingBatch = false;
        alerted += result.alerted;
        errored += result.errored;
        pendingExecutions.length = 0;
      }
    }
  } catch (error) {
    if (processingBatch) {
      throw error;
    }
    listingFailed = true;
    listingError = error;
  }

  if (pendingExecutions.length > 0) {
    const result = await postFailureBatch(
      postFailureBatchOptions({
        client,
        poster,
        executions: pendingExecutions,
        pollOptions: options,
        checkpointBlocked,
        lookbackSince: since,
      }),
    );
    alerted += result.alerted;
    errored += result.errored;
  }

  if (listingFailed) {
    throw listingError;
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
