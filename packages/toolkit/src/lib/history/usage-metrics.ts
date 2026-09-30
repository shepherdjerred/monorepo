import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";
import {
  EMPTY_QUOTA_METRICS,
  loadQuotaMetrics,
  observeExportResults,
  startUsageMetricsPush,
  type QuotaMetrics,
} from "./metrics-push.ts";
import {
  UsageExportLedger,
  type UsageEventReader,
  type UsageExportRefresh,
} from "./usage-export.ts";

export type UsageMetricsLog = (
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>;

export type UsageMetricsExportOptions = {
  readonly ledgerPath: string;
  readonly snapshotsPath: string;
  readonly exporter: PushMetricExporter;
  readonly hostname: string;
  readonly log: UsageMetricsLog;
  readonly exportIntervalMillis?: number;
};

export type UsageMetricsExport = {
  /**
   * Advance the ledger from the index and reload Brim's quota cache. Quota is
   * cleared rather than left stale when the cache fails to load, and the
   * failure is rethrown after the usage totals are published.
   */
  refresh: (reader: UsageEventReader, now: Date) => Promise<UsageExportRefresh>;
  shutdown: () => Promise<void>;
};

/** The history daemon's metrics push: export ledger + OTel exporter + Brim. */
export async function startUsageMetricsExport(
  options: UsageMetricsExportOptions,
): Promise<UsageMetricsExport> {
  const ledger = await UsageExportLedger.open(options.ledgerPath);
  // Log the first failure of a streak and the recovery, not every minute.
  let failing = false;
  const exporter = observeExportResults(options.exporter, (error) => {
    if (error !== null && !failing) {
      failing = true;
      void options.log("usage metrics export failed", {
        error: error.message,
      });
    } else if (error === null && failing) {
      failing = false;
      void options.log("usage metrics export recovered");
    }
  });
  const push = startUsageMetricsPush({
    exporter,
    hostname: options.hostname,
    ...(options.exportIntervalMillis === undefined
      ? {}
      : { exportIntervalMillis: options.exportIntervalMillis }),
  });
  let reportedMissingQuota = false;

  const loadQuota = async (): Promise<QuotaMetrics> => {
    const quota = await loadQuotaMetrics(options.snapshotsPath);
    if (quota !== null) {
      reportedMissingQuota = false;
      return quota;
    }
    if (!reportedMissingQuota) {
      reportedMissingQuota = true;
      await options.log(
        "Brim snapshot cache not found; skipping quota metrics",
        { snapshotsPath: options.snapshotsPath },
      );
    }
    return EMPTY_QUOTA_METRICS;
  };

  return {
    refresh: async (reader, now) => {
      let quota = EMPTY_QUOTA_METRICS;
      let quotaError: Error | null = null;
      try {
        quota = await loadQuota();
      } catch (error: unknown) {
        quotaError =
          error instanceof Error
            ? error
            : new Error("Brim quota load failed", { cause: error });
      }
      let result: UsageExportRefresh = {
        seeded: false,
        newKeys: 0,
        countedEvents: 0,
        prunedKeys: 0,
      };
      let usageError: Error | null = null;
      try {
        result = ledger.refresh(reader, now);
      } catch (error: unknown) {
        usageError =
          error instanceof Error
            ? error
            : new Error("Usage export ledger refresh failed", { cause: error });
      }
      // A failed refresh rolled back, so the persisted totals are still the
      // last consistent (monotonic) values.
      push.update({ usage: ledger.totals(), quota });
      if (usageError !== null) {
        throw usageError;
      }
      if (quotaError !== null) {
        throw quotaError;
      }
      return result;
    },
    shutdown: async () => {
      try {
        await push.forceFlush();
      } finally {
        await push.shutdown();
        ledger.close();
      }
    },
  };
}
