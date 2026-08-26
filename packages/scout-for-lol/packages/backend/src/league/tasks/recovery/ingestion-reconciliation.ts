import { getLastSuccessfulPollAt } from "#src/league/tasks/recovery/app-state.ts";
import { detectDowntime } from "#src/league/tasks/recovery/detect-downtime.ts";
import { sendOfflineNotification } from "#src/league/tasks/recovery/offline-notification.ts";
import { backfillMatchesToS3 } from "#src/league/tasks/recovery/backfill-to-s3.ts";
import { createLogger } from "#src/logger.ts";
import { downtimeDetectedTotal } from "#src/metrics/index.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("ingestion-reconciliation");

export async function runIngestionReconciliation(): Promise<void> {
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
