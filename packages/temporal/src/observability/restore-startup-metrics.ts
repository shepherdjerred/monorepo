import * as Sentry from "@sentry/bun";
import { restoreGlitterCorpusSnapshotMetrics } from "#activities/glitter/corpus/glitter-corpus-snapshot.ts";
import { restoreSeaweedFsBackupMetrics } from "#activities/homelab/seaweedfs-backup.ts";
import { restoreVeleroR2AuditMetrics } from "#activities/homelab/velero-r2-audit-state.ts";

import { formatError } from "#shared/format-error.ts";
import { isTransientStorageError } from "#shared/infra/s3.ts";
import { retryUntilReady } from "#shared/startup-retry.ts";
import { log as jsonLog } from "#observability/log.ts";

export async function restoreVeleroR2MetricsAfterWorkerStart(): Promise<void> {
  try {
    await restoreVeleroR2AuditMetrics();
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog(
      "error",
      "R2 audit metric restoration failed; freshness alert remains active",
      { error: formatError(error) },
    );
  }
}

export async function restoreGlitterCorpusMetricsAfterWorkerStart(
  isClosed: () => boolean,
): Promise<void> {
  try {
    const result = await retryUntilReady({
      operation: restoreGlitterCorpusSnapshotMetrics,
      shouldRetry: isTransientStorageError,
      isClosed,
      onRetry: ({ attempt, delayMs, error }) => {
        jsonLog(
          "error",
          "Glitter corpus snapshot metric restoration failed; retrying",
          { attempt, delayMs, error: formatError(error) },
        );
      },
      onEscalate: ({ attempt, error }) => {
        Sentry.captureMessage(
          `Glitter corpus snapshot metric restoration has failed ${String(attempt)} consecutive times (latest error: ${formatError(error)}); still retrying`,
          "warning",
        );
      },
    });
    if (result === "succeeded") {
      jsonLog("info", "Glitter corpus snapshot metric restoration completed");
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog(
      "error",
      "Glitter corpus snapshot metric restoration failed; corpus operations fail closed while other queues continue",
      { error: formatError(error) },
    );
  }
}

export async function restoreSeaweedFsMetricsAfterWorkerStart(
  isClosed: () => boolean,
): Promise<void> {
  try {
    const result = await retryUntilReady({
      operation: restoreSeaweedFsBackupMetrics,
      shouldRetry: isTransientStorageError,
      isClosed,
      onRetry: ({ attempt, delayMs, error }) => {
        jsonLog(
          "error",
          "SeaweedFS backup metric restoration failed; retrying",
          { attempt, delayMs, error: formatError(error) },
        );
      },
      onEscalate: ({ attempt, error }) => {
        Sentry.captureMessage(
          `SeaweedFS backup metric restoration has failed ${String(attempt)} consecutive times (latest error: ${formatError(error)}); still retrying`,
          "warning",
        );
      },
    });
    if (result === "succeeded") {
      jsonLog("info", "SeaweedFS backup metric restoration completed");
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog("error", "SeaweedFS backup metric restoration stopped", {
      error: formatError(error),
    });
  }
}
