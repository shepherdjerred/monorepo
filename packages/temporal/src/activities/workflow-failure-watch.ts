import { type AlertmanagerAlert, type AlertPoster } from "#lib/alertmanager.ts";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";
import { temporalFailureWatcherAlertsTotal } from "#observability/metrics.ts";
import {
  checkpointForExecution,
  workflowExecutionKey,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";
import { buildFailureAlertForExecution } from "./workflow-failure-watch-detail.ts";
import { buildWorkflowFailureOverflowAlert } from "./workflow-failure-watch-overflow.ts";
import { scanWorkflowFailureVisibility } from "./workflow-failure-watch-scan.ts";
import type { WorkflowVisibilityClient } from "#shared/workflow-visibility-client.ts";

/**
 * Polls the Temporal visibility API for workflow executions that closed as
 * Failed/TimedOut in the lookback window, extracts each execution's
 * structured failure via `handle.result()`, and posts at most 100 detail-rich
 * alerts plus one aggregate overflow alert to Alertmanager (which routes to Alerts — see
 * `packages/homelab/.../argo-applications/prometheus.ts`). Each successful
 * detail batch heartbeats its last item and consumed budget. A retry scans the
 * full lookback and applies a conservative checkpoint because the public
 * visibility iterator does not expose a precision-safe page token. Safe to overlap
 * polls because Alertmanager dedups by label set
 * (identity = alertname + workflowType + taskQueue + workflowId + runId).
 */

const COMPONENT = "temporal-failure-watch";
// Keep a full day of terminal executions queryable so a worker outage can be
// recovered by the next poll. The alert TTL covers this window plus delivery
// margin, preventing a recovered poll from re-paging an execution that was
// already observed while leaving Alertmanager time to notify Alerts.
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

// Temporal visibility pages are newest-first. The SDK exposes timestamps as
// millisecond-precision Dates, so the checkpoint treats each close-time
// millisecond as a cohort and records the completed execution keys within it.
// This is conservative for the server's nanosecond ordering while still
// advancing past a cohort across retries.
export type PollWorkflowFailuresResult = {
  scanned: number;
  alerted: number;
  errored: number;
  overflowed: boolean;
};

/** Narrow structural slice of `Client["workflow"]` — real client and test fakes both satisfy it. */

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
    options.checkpoint?.cursor?.lookbackSince ??
    new Date(options.now.getTime() - options.lookbackMs);
  return { since, query: buildVisibilityQuery(since) };
}

type FailureDetailResult = {
  alerted: number;
  errored: number;
};

type FailureBatchResult = FailureDetailResult & {
  checkpointBlocked: boolean;
  checkpoint: WorkflowFailureWatchCheckpoint | undefined;
};

type CheckpointProgressOptions = {
  checkpointBlocked: boolean;
  checkpoint: WorkflowFailureWatchCheckpoint | undefined;
  lookbackSince: Date;
  detailedAlertsConsumed: number;
  onCheckpoint:
    ((checkpoint: WorkflowFailureWatchCheckpoint) => void) | undefined;
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
  detailedAlertsConsumed: number;
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
      checkpoint: input.pollOptions.checkpoint,
      lookbackSince: input.lookbackSince,
      detailedAlertsConsumed: input.detailedAlertsConsumed,
      onCheckpoint: input.pollOptions.onCheckpoint,
    },
  };
}

function pollOptionsWithCheckpoint(
  options: PollWorkflowFailuresOptions,
  checkpoint: WorkflowFailureWatchCheckpoint | undefined,
): PollWorkflowFailuresOptions {
  return checkpoint === undefined ? options : { ...options, checkpoint };
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
  let checkpoint = checkpointProgress.checkpoint;
  let detailedAlertsConsumed = checkpointProgress.detailedAlertsConsumed;
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
      // Recorded after the poster succeeds, mirroring the archive-after-success pattern
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
    detailedAlertsConsumed += chunk.length;
    const checkpointProgressResult = advanceRecoveryCheckpoint({
      result: chunkResult,
      executions: chunk,
      checkpointBlocked,
      checkpoint,
      onCheckpoint: checkpointProgress.onCheckpoint,
      lookbackSince: checkpointProgress.lookbackSince,
      detailedAlertsConsumed,
    });
    checkpointBlocked = checkpointProgressResult.checkpointBlocked;
    checkpoint = checkpointProgressResult.checkpoint;
  }

  return {
    alerted: alerts.length,
    errored,
    checkpointBlocked,
    checkpoint,
  };
}

type RecoveryCheckpointProgress = {
  checkpointBlocked: boolean;
  checkpoint: WorkflowFailureWatchCheckpoint | undefined;
};

type AdvanceRecoveryCheckpointInput = {
  result: FailureDetailResult;
  executions: readonly FailedWorkflowExecution[];
  checkpointBlocked: boolean;
  checkpoint: WorkflowFailureWatchCheckpoint | undefined;
  onCheckpoint:
    ((checkpoint: WorkflowFailureWatchCheckpoint) => void) | undefined;
  lookbackSince: Date;
  detailedAlertsConsumed: number;
};

function advanceRecoveryCheckpoint(
  input: AdvanceRecoveryCheckpointInput,
): RecoveryCheckpointProgress {
  const budgetCheckpoint = {
    detailedAlertsConsumed: input.detailedAlertsConsumed,
    ...(input.checkpoint?.cursor === undefined
      ? {}
      : { cursor: input.checkpoint.cursor }),
  } satisfies WorkflowFailureWatchCheckpoint;
  if (input.result.errored !== 0) {
    input.onCheckpoint?.(budgetCheckpoint);
    return { checkpointBlocked: true, checkpoint: budgetCheckpoint };
  }
  if (input.checkpointBlocked) {
    input.onCheckpoint?.(budgetCheckpoint);
    return {
      checkpointBlocked: true,
      checkpoint: budgetCheckpoint,
    };
  }
  if (input.onCheckpoint === undefined) {
    return {
      checkpointBlocked: false,
      checkpoint: budgetCheckpoint,
    };
  }
  const lastExecution = input.executions.at(-1);
  if (lastExecution === undefined) {
    return {
      checkpointBlocked: input.checkpointBlocked,
      checkpoint: input.checkpoint,
    };
  }
  const closeTimeMs = lastExecution.closeTime.getTime();
  const processedExecutionKeys = new Set(
    input.checkpoint?.cursor?.closeTime.getTime() === closeTimeMs
      ? (input.checkpoint.cursor.processedExecutionKeys ?? [])
      : [],
  );
  for (const execution of input.executions) {
    if (execution.closeTime.getTime() === closeTimeMs) {
      processedExecutionKeys.add(
        workflowExecutionKey(execution.workflowId, execution.runId),
      );
    }
  }
  const baseCheckpoint = checkpointForExecution(
    lastExecution,
    input.lookbackSince,
    input.detailedAlertsConsumed,
  );
  const baseCursor = baseCheckpoint.cursor;
  if (baseCursor === undefined) {
    throw new Error("execution checkpoint cursor was not created");
  }
  const nextCheckpoint = {
    ...baseCheckpoint,
    cursor: {
      ...baseCursor,
      processedExecutionKeys: [...processedExecutionKeys],
    },
  } satisfies WorkflowFailureWatchCheckpoint;
  input.onCheckpoint(nextCheckpoint);
  return { checkpointBlocked: false, checkpoint: nextCheckpoint };
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
  let errored = 0;
  let alerted = 0;
  let checkpointBlocked = false;
  let recoveryCheckpoint = checkpoint;
  const postDetails = async (
    executions: readonly FailedWorkflowExecution[],
  ): Promise<void> => {
    const result = await postFailureBatch(
      postFailureBatchOptions({
        client,
        poster,
        executions,
        pollOptions: pollOptionsWithCheckpoint(options, recoveryCheckpoint),
        checkpointBlocked,
        lookbackSince: since,
        detailedAlertsConsumed: recoveryCheckpoint?.detailedAlertsConsumed ?? 0,
      }),
    );
    checkpointBlocked = result.checkpointBlocked;
    recoveryCheckpoint = result.checkpoint;
    alerted += result.alerted;
    errored += result.errored;
  };

  const scan = await scanWorkflowFailureVisibility(client, {
    query,
    checkpoint,
    detailedAlertsConsumed: checkpoint?.detailedAlertsConsumed ?? 0,
    onDetailBatch: postDetails,
  });
  if (scan.pendingDetails.length > 0) await postDetails(scan.pendingDetails);

  if (scan.listingError !== undefined) throw scan.listingError;

  const overflowed = scan.omitted.length > 0;
  if (overflowed) {
    await poster([
      buildWorkflowFailureOverflowAlert(scan.omitted, since, options.ttlMs),
    ]);
    temporalFailureWatcherAlertsTotal.inc({ workflowType: "overflow" });
    advanceRecoveryCheckpoint({
      result: { alerted: 0, errored: 0 },
      executions: scan.omitted,
      checkpointBlocked,
      checkpoint: recoveryCheckpoint,
      onCheckpoint: options.onCheckpoint,
      lookbackSince: since,
      detailedAlertsConsumed:
        recoveryCheckpoint?.detailedAlertsConsumed ??
        scan.detailedAlertsSelected,
    });
  }

  // Isolated per-execution detail-extraction failures are tolerated, but if
  // EVERY execution in a non-empty batch failed, the cause is systematic
  // (e.g. the Temporal server rejected result() calls broadly) — throw so
  // Temporal retries instead of silently reporting a clean poll that alerted
  // on nothing.
  if (!overflowed && alerted === 0 && scan.scanned > 0) {
    throw new Error(
      `workflow-failure-watch found ${String(scan.scanned)} failed execution(s) but could not extract detail for any of them (${String(errored)} errored); treating as a systematic failure so Temporal retries.`,
    );
  }

  jsonLog("info", "workflow-failure-watch poll complete", {
    scanned: scan.scanned,
    alerted,
    errored,
    overflowed,
  });

  return { scanned: scan.scanned, alerted, errored, overflowed };
}
