import { getLastSuccessfulPollAt } from "#src/league/tasks/recovery/app-state.ts";
import { detectDowntime } from "#src/league/tasks/recovery/detect-downtime.ts";
import { sendOfflineNotification } from "#src/league/tasks/recovery/offline-notification.ts";
import { backfillMatchesToS3 } from "#src/league/tasks/recovery/backfill-to-s3.ts";
import { createLogger } from "#src/logger.ts";
import { downtimeDetectedTotal } from "#src/metrics/index.ts";
import { ingestionReconciliationSkipsTotal } from "#src/metrics/recovery.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("ingestion-reconciliation");

let isReconciliationInProgress = false;
let reconciliationStartTime: number | undefined;
let lastCompletedAt: number | undefined;

// Under the 60-second schedule cadence ordinary scheduled runs never land
// inside this window, but the queue-serialized duplicate of a boot+schedule
// coincidence dequeues seconds after the prior run finished.
const RECENT_COMPLETION_WINDOW_MS = 30_000;

export function resetReconciliationState(): void {
  isReconciliationInProgress = false;
  reconciliationStartTime = undefined;
  lastCompletedAt = undefined;
}

function shouldSkipReconciliationRun(): boolean {
  if (!isReconciliationInProgress) {
    return shouldSkipRecentlyCompletedRun();
  }

  const elapsed =
    reconciliationStartTime === undefined
      ? 0
      : Date.now() - reconciliationStartTime;

  // Check if the lock is stale (stuck for over 30 minutes — a downtime
  // backfill legitimately runs far longer than a poll)
  if (elapsed > 30 * 60 * 1000) {
    logger.error(
      `⚠️  Reconciliation lock timeout detected after ${Math.round(elapsed / 1000).toString()}s, force-resetting stale lock`,
    );
    ingestionReconciliationSkipsTotal.inc({ reason: "timeout_reset" });
    Sentry.captureMessage(
      "Ingestion reconciliation lock timeout - force reset",
      {
        level: "warning",
        tags: { source: "ingestion-reconciliation" },
        extra: { elapsedMs: elapsed },
      },
    );
    isReconciliationInProgress = false;
    reconciliationStartTime = undefined;
    return false;
  }

  logger.info(
    `⏸️  Ingestion reconciliation already in progress (${Math.round(elapsed / 1000).toString()}s elapsed), skipping this run`,
  );
  ingestionReconciliationSkipsTotal.inc({ reason: "concurrent_run" });
  return true;
}

function shouldSkipRecentlyCompletedRun(): boolean {
  const sinceCompleted =
    lastCompletedAt === undefined ? undefined : Date.now() - lastCompletedAt;
  if (
    sinceCompleted === undefined ||
    sinceCompleted >= RECENT_COMPLETION_WINDOW_MS
  ) {
    return false;
  }

  logger.info(
    `⏭️  Ingestion reconciliation completed ${Math.round(sinceCompleted / 1000).toString()}s ago, skipping this run`,
  );
  ingestionReconciliationSkipsTotal.inc({ reason: "recent_completion" });
  return true;
}

export async function runIngestionReconciliation(): Promise<void> {
  // The schedule-triggered and gateway-ready workflows carry different
  // workflow IDs, so Temporal cannot deduplicate them against each other
  // during downtime recovery. Exactly one backend replica executes the
  // background activity queue (replicas: 1, Recreate strategy in the homelab
  // scout chart) and its worker runs one activity at a time
  // (maxConcurrentActivityTaskExecutions: 1 in connected-runtime.ts), so the
  // overlapping start dequeues only after the prior run finished — that
  // ordering is what lets the completion-recency check reliably observe the
  // previous run. The in-flight flag cannot fire under that serialization;
  // it stays as defense in case worker concurrency ever changes. Skipping is
  // safe: the fixed schedule retries within a minute and the boot-time start
  // is best-effort.
  if (shouldSkipReconciliationRun()) {
    return;
  }
  isReconciliationInProgress = true;
  reconciliationStartTime = Date.now();
  try {
    await reconcileIngestion();
    // Success only: a failed run must not suppress the queued retry.
    lastCompletedAt = Date.now();
  } finally {
    isReconciliationInProgress = false;
    reconciliationStartTime = undefined;
  }
}

async function reconcileIngestion(): Promise<void> {
  logger.info("Running ingestion reconciliation");

  const lastPollAt = await getLastSuccessfulPollAt();
  const startupAt = new Date();
  const downtime = detectDowntime(lastPollAt, startupAt);

  if (!downtime.downtimeDetected) {
    logger.info(
      lastPollAt === undefined
        ? "First startup ever, no recovery needed"
        : `No significant downtime detected (${downtime.downtimeDurationMs.toString()}ms since last poll)`,
    );
    return;
  }

  const downtimeMinutes = Math.round(downtime.downtimeDurationMs / (60 * 1000));
  const downtimeHours = Math.round(downtimeMinutes / 60);
  logger.info(
    `Downtime detected: ~${downtimeHours.toString()} hours (${downtimeMinutes.toString()} minutes)`,
  );

  if (downtime.shouldNotifyOffline) {
    downtimeDetectedTotal.inc({ severity: "offline_notification" });
    logger.info("Downtime exceeds 1 day, sending offline notification");
    try {
      await sendOfflineNotification(downtime.lastPollAt ?? startupAt);
    } catch (error) {
      logger.error("Failed to send offline notification:", error);
      Sentry.captureException(error, {
        tags: { source: "ingestion-reconciliation-notification" },
      });
    }
  }

  if (downtime.shouldBackfill && downtime.lastPollAt !== undefined) {
    const backfillStart = downtime.lastPollAt;
    logger.info("Starting S3 backfill for missed matches");
    try {
      const result = await backfillMatchesToS3(backfillStart, startupAt);
      logger.info(
        `Backfill completed: ${result.totalMatchesSaved.toString()} matches saved to S3`,
      );
    } catch (error) {
      logger.error("Backfill failed:", error);
      Sentry.captureException(error, {
        tags: { source: "ingestion-reconciliation-backfill" },
      });
      throw error;
    }
  }

  logger.info("Ingestion reconciliation complete");
}
