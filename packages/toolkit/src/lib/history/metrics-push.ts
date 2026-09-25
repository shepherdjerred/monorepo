import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import {
  cocoaToMs,
  loadSnapshots,
  type UsageSnapshot,
} from "#lib/brim/cache.ts";
import { EMPTY_USAGE_TOTALS, type UsageExportTotals } from "./usage-export.ts";

/**
 * Pushes the export ledger's monotonic usage totals and Brim's quota windows
 * to the homelab over OTLP/HTTP.
 *
 * Every instrument is observable and reads in-memory state the daemon
 * replaces after each scan, so the OTel periodic reader is the only timer.
 * Metric names already carry their Prometheus spelling and no units: the
 * Alloy gateway exports with `add_metric_suffixes = false`, so what is named
 * here is exactly what lands in Prometheus.
 *
 * Labels are bounded (source, model, token type, provider, window). Prompts,
 * paths, workspaces, and session ids never leave the machine.
 */

export const USAGE_METRICS_SERVICE_NAME = "toolkit-history";
export const USAGE_METRICS_EXPORT_INTERVAL_MS = 60_000;

export const USAGE_METRIC_NAMES = {
  tokens: "ai_usage_tokens_total",
  cost: "ai_usage_cost_usd_total",
  events: "ai_usage_events_total",
  unpriced: "ai_usage_unpriced_events_total",
  quotaUsedRatio: "ai_subscription_quota_used_ratio",
  quotaReset: "ai_subscription_quota_reset_timestamp_seconds",
  snapshotTimestamp: "ai_subscription_snapshot_timestamp_seconds",
} as const;

export type QuotaWindowRatio = {
  readonly provider: string;
  readonly windowId: string;
  readonly windowKind: string;
  readonly ratio: number;
};

export type QuotaWindowReset = {
  readonly provider: string;
  readonly windowId: string;
  readonly resetSeconds: number;
};

export type QuotaSnapshotTime = {
  readonly provider: string;
  readonly snapshotSeconds: number;
};

export type QuotaMetrics = {
  readonly usedRatios: readonly QuotaWindowRatio[];
  readonly resets: readonly QuotaWindowReset[];
  readonly snapshots: readonly QuotaSnapshotTime[];
};

export const EMPTY_QUOTA_METRICS: QuotaMetrics = {
  usedRatios: [],
  resets: [],
  snapshots: [],
};

/**
 * Brim encodes a window's kind as a Swift enum with associated values, which
 * `Codable` writes as a single-key object (`{"rolling": {...}}`). Anything
 * else is a changed contract, not a kind to guess at.
 */
function windowKind(provider: string, windowId: string, kind: object): string {
  const keys = Object.keys(kind);
  const [only] = keys;
  if (only === undefined || keys.length !== 1) {
    throw new Error(
      `Brim window ${provider}/${windowId} has a kind with ${String(keys.length)} keys; expected exactly one.`,
    );
  }
  return only;
}

export function quotaMetricsFromSnapshots(
  snapshots: readonly UsageSnapshot[],
): QuotaMetrics {
  const usedRatios: QuotaWindowRatio[] = [];
  const resets: QuotaWindowReset[] = [];
  const times: QuotaSnapshotTime[] = [];
  for (const snapshot of snapshots) {
    times.push({
      provider: snapshot.provider,
      snapshotSeconds: cocoaToMs(snapshot.sourceTimestamp) / 1000,
    });
    for (const window of snapshot.windows) {
      if (window.usedPercent != null) {
        usedRatios.push({
          provider: snapshot.provider,
          windowId: window.id,
          windowKind: windowKind(snapshot.provider, window.id, window.kind),
          ratio: window.usedPercent / 100,
        });
      }
      if (window.resetAt != null) {
        resets.push({
          provider: snapshot.provider,
          windowId: window.id,
          resetSeconds: cocoaToMs(window.resetAt) / 1000,
        });
      }
    }
  }
  return { usedRatios, resets, snapshots: times };
}

/**
 * Brim's quota cache, mapped to metrics. `null` means the cache file does not
 * exist (Brim not installed or not yet run), which is an expected absence. A
 * file that exists but does not parse throws.
 */
export async function loadQuotaMetrics(
  filePath: string,
): Promise<QuotaMetrics | null> {
  return (await Bun.file(filePath).exists())
    ? quotaMetricsFromSnapshots(await loadSnapshots(filePath))
    : null;
}

export type UsageMetricsState = {
  readonly usage: UsageExportTotals;
  readonly quota: QuotaMetrics;
};

export type UsageMetricsPush = {
  update: (state: UsageMetricsState) => void;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
};

export type UsageMetricsPushOptions = {
  readonly exporter: PushMetricExporter;
  /** Becomes `service.instance.id`, which Alloy maps to `instance`. */
  readonly hostname: string;
  readonly exportIntervalMillis?: number;
};

/** `ExportResultCode.SUCCESS` from `@opentelemetry/core`, not a direct dependency. */
const EXPORT_RESULT_SUCCESS = 0;

function exportSucceeded(code: number): boolean {
  return code === EXPORT_RESULT_SUCCESS;
}

/**
 * Reports each export outcome. The SDK routes export failures to the global
 * OTel diagnostics logger, which is a no-op unless configured, so without
 * this a daemon pushing into a dead endpoint would look healthy.
 */
export function observeExportResults(
  exporter: PushMetricExporter,
  onResult: (error: Error | null) => void,
): PushMetricExporter {
  return {
    export: (metrics, resultCallback) => {
      exporter.export(metrics, (result) => {
        onResult(
          exportSucceeded(result.code)
            ? null
            : (result.error ?? new Error("OTLP metrics export failed")),
        );
        resultCallback(result);
      });
    },
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
    ...(exporter.selectAggregationTemporality === undefined
      ? {}
      : {
          selectAggregationTemporality:
            exporter.selectAggregationTemporality.bind(exporter),
        }),
    ...(exporter.selectAggregation === undefined
      ? {}
      : { selectAggregation: exporter.selectAggregation.bind(exporter) }),
  };
}

export function createOtlpMetricsExporter(
  endpoint: string,
): OTLPMetricExporter {
  return new OTLPMetricExporter({ url: endpoint });
}

export function startUsageMetricsPush(
  options: UsageMetricsPushOptions,
): UsageMetricsPush {
  const interval =
    options.exportIntervalMillis ?? USAGE_METRICS_EXPORT_INTERVAL_MS;
  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      "service.name": USAGE_METRICS_SERVICE_NAME,
      "service.instance.id": options.hostname,
    }),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: options.exporter,
        exportIntervalMillis: interval,
        exportTimeoutMillis: Math.min(30_000, interval),
      }),
    ],
  });
  const meter = provider.getMeter(USAGE_METRICS_SERVICE_NAME);
  let state: UsageMetricsState = {
    usage: EMPTY_USAGE_TOTALS,
    quota: EMPTY_QUOTA_METRICS,
  };

  meter
    .createObservableCounter(USAGE_METRIC_NAMES.tokens, {
      description: "AI tokens used on this machine since export was enabled.",
    })
    .addCallback((result) => {
      for (const total of state.usage.tokens) {
        result.observe(total.tokens, {
          source: total.source,
          model: total.model,
          type: total.type,
        });
      }
    });
  meter
    .createObservableCounter(USAGE_METRIC_NAMES.cost, {
      description: "Catalog-priced AI usage cost in USD.",
    })
    .addCallback((result) => {
      for (const total of state.usage.models) {
        result.observe(total.costUsd, {
          source: total.source,
          model: total.model,
        });
      }
    });
  meter
    .createObservableCounter(USAGE_METRIC_NAMES.events, {
      description: "AI usage events (turns or generations).",
    })
    .addCallback((result) => {
      for (const total of state.usage.models) {
        result.observe(total.events, {
          source: total.source,
          model: total.model,
        });
      }
    });
  meter
    .createObservableCounter(USAGE_METRIC_NAMES.unpriced, {
      description:
        "AI usage events whose tokens the price catalog could not price.",
    })
    .addCallback((result) => {
      for (const total of state.usage.sources) {
        result.observe(total.unpricedEvents, { source: total.source });
      }
    });
  meter
    .createObservableGauge(USAGE_METRIC_NAMES.quotaUsedRatio, {
      description: "Share of a subscription quota window used, 0..1.",
    })
    .addCallback((result) => {
      for (const window of state.quota.usedRatios) {
        result.observe(window.ratio, {
          provider: window.provider,
          window_id: window.windowId,
          window_kind: window.windowKind,
        });
      }
    });
  meter
    .createObservableGauge(USAGE_METRIC_NAMES.quotaReset, {
      description: "Unix time a subscription quota window resets.",
    })
    .addCallback((result) => {
      for (const window of state.quota.resets) {
        result.observe(window.resetSeconds, {
          provider: window.provider,
          window_id: window.windowId,
        });
      }
    });
  meter
    .createObservableGauge(USAGE_METRIC_NAMES.snapshotTimestamp, {
      description: "Unix time Brim last refreshed a provider's quota.",
    })
    .addCallback((result) => {
      for (const snapshot of state.quota.snapshots) {
        result.observe(snapshot.snapshotSeconds, {
          provider: snapshot.provider,
        });
      }
    });

  return {
    update: (next) => {
      state = next;
    },
    forceFlush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
