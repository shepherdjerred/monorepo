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
 * detail batch heartbeats its newest close time so a timed-out activity retry
 * resumes near its last durable checkpoint instead of rescanning the whole
 * lookback. Safe to overlap polls because Alertmanager dedups by label set
 * (identity = alertname + workflowType + taskQueue + workflowId + runId).
 */

const COMPONENT = "temporal-failure-watch";
// Keep a full day of terminal executions queryable so a worker outage can be
// recovered by the next poll. The alert TTL covers this window plus delivery
// margin, preventing a recovered poll from re-paging an execution that was
// already observed while leaving Alertmanager time to notify PagerDuty.
export const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
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
const VISIBILITY_PAGE_SIZE = 100;

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
    list: (options: { query: string; pageSize?: number }) => AsyncIterable<{
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
  const minimumTtlMs = DEFAULT_LOOKBACK_MS + ALERT_DELIVERY_MARGIN_MS;
  if (ttlMs < minimumTtlMs) {
    throw new Error(
      `TEMPORAL_FAILURE_ALERT_TTL_SECONDS must be at least ${String(minimumTtlMs / 1000)} to cover the recovery lookback and alert delivery margin, got ${raw}`,
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
  return `ExecutionStatus IN ("Failed", "TimedOut") AND CloseTime > "${since.toISOString()}"`;
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

function recordBatchCheckpoint(
  result: FailureBatchResult,
  executions: readonly FailedWorkflowExecution[],
  onCheckpoint:
    | ((checkpoint: WorkflowFailureWatchCheckpoint) => void)
    | undefined,
): void {
  if (onCheckpoint === undefined || result.errored !== 0) {
    return;
  }
  const lastExecution = executions.at(-1);
  if (lastExecution !== undefined) {
    onCheckpoint(checkpointForExecution(lastExecution));
  }
}

export type PollWorkflowFailuresOptions = {
  now: Date;
  lookbackMs: number;
  ttlMs: number;
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
  const { now, lookbackMs, checkpoint } = options;
  const lookbackSince = now.getTime() - lookbackMs;
  const checkpointSince =
    checkpoint === undefined
      ? Number.NEGATIVE_INFINITY
      : checkpoint.closeTime.getTime() - 1;
  const since = new Date(Math.max(lookbackSince, checkpointSince));
  const query = buildVisibilityQuery(since);

  const pendingExecutions: FailedWorkflowExecution[] = [];
  let scanned = 0;
  let errored = 0;
  let alerted = 0;
  let listingFailed = false;
  let listingError: unknown;
  let processingBatch = false;
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
        info.closeTime.getTime() < checkpoint.closeTime.getTime()
      ) {
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
        processingBatch = true;
        const result = await postFailureBatch(
          client,
          poster,
          pendingExecutions,
          options,
        );
        recordBatchCheckpoint(result, pendingExecutions, options.onCheckpoint);
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
      client,
      poster,
      pendingExecutions,
      options,
    );
    recordBatchCheckpoint(result, pendingExecutions, options.onCheckpoint);
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
