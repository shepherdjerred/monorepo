import * as Sentry from "@sentry/bun";
import { restoreGlitterCorpusSnapshotMetrics } from "./activities/glitter-corpus-snapshot.ts";
import { isTransientCorpusStorageError } from "./activities/glitter-corpus-store.ts";
import { log as jsonLog } from "./observability/log.ts";
import { retryUntilReady } from "./shared/startup-retry.ts";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function restoreGlitterCorpusMetricsAfterWorkerStart(
  isClosed: () => boolean,
): Promise<void> {
  try {
    const result = await retryUntilReady({
      operation: restoreGlitterCorpusSnapshotMetrics,
      shouldRetry: isTransientCorpusStorageError,
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
