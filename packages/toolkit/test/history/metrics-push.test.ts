import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  type MetricData,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { COCOA_EPOCH_OFFSET_SECONDS } from "#lib/brim/cache.ts";
import {
  loadQuotaMetrics,
  quotaMetricsFromSnapshots,
  startUsageMetricsPush,
  USAGE_METRIC_NAMES,
} from "#lib/history/metrics-push.ts";
import { startUsageMetricsExport } from "#lib/history/usage-metrics.ts";
import type { UsageEventReader } from "#lib/history/usage-export.ts";

const FIXTURE = path.join(
  import.meta.dirname,
  "history-fixtures/brim-snapshots.json",
);

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metrics-push-"));
  directories.push(directory);
  return directory;
}

function unix(cocoaSeconds: number): number {
  return cocoaSeconds + COCOA_EPOCH_OFFSET_SECONDS;
}

function exported(exporter: InMemoryMetricExporter): MetricData[] {
  return exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics);
}

function latest(
  exporter: InMemoryMetricExporter,
  name: string,
): MetricData | undefined {
  return exported(exporter).findLast(
    (metric) => metric.descriptor.name === name,
  );
}

function points(metric: MetricData | undefined): unknown[] {
  return (metric?.dataPoints ?? []).map((point) => ({
    attributes: point.attributes,
    value: point.value,
  }));
}

describe("Brim quota mapping", () => {
  test("maps windows to ratios, resets, and snapshot times", async () => {
    const quota = await loadQuotaMetrics(FIXTURE);
    expect(quota).toEqual({
      usedRatios: [
        {
          provider: "claude-code",
          windowId: "five-hour",
          windowKind: "rolling",
          ratio: 0.42,
        },
        {
          provider: "claude-code",
          windowId: "weekly",
          windowKind: "weekly",
          ratio: 0.105,
        },
        {
          provider: "antigravity",
          windowId: "antigravity-gemini-5h",
          windowKind: "modelScoped",
          ratio: 1,
        },
      ],
      resets: [
        {
          provider: "claude-code",
          windowId: "five-hour",
          resetSeconds: unix(800_000_000),
        },
        {
          provider: "claude-code",
          windowId: "weekly",
          resetSeconds: unix(800_500_000),
        },
      ],
      snapshots: [
        { provider: "claude-code", snapshotSeconds: unix(799_990_000) },
        { provider: "antigravity", snapshotSeconds: unix(799_980_000) },
      ],
    });
  });

  test("a missing cache is absent, a corrupt one throws", async () => {
    const directory = await tempDir();
    await expect(
      loadQuotaMetrics(path.join(directory, "missing.json")),
    ).resolves.toBeNull();
    const corrupt = path.join(directory, "snapshots.json");
    await writeFile(corrupt, "{not json");
    await expect(loadQuotaMetrics(corrupt)).rejects.toThrow(/not valid JSON/);
  });

  test("a window kind that is not a single-case enum is a broken contract", () => {
    expect(() =>
      quotaMetricsFromSnapshots([
        {
          provider: "p",
          windows: [
            {
              id: "w",
              label: "W",
              kind: {},
              usedPercent: 1,
              sourceTimestamp: 0,
            },
          ],
          sourceTimestamp: 0,
        },
      ]),
    ).toThrow(/expected exactly one/);
  });
});

describe("usage metrics push", () => {
  test("exports usage counters and quota gauges with exact names", async () => {
    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const push = startUsageMetricsPush({
      exporter,
      hostname: "test-mac",
      exportIntervalMillis: 3_600_000,
    });
    push.update({
      usage: {
        tokens: [
          { source: "claude", model: "opus", type: "input", tokens: 1200 },
          { source: "claude", model: "opus", type: "output", tokens: 300 },
        ],
        models: [{ source: "claude", model: "opus", costUsd: 2.5, events: 4 }],
        sources: [{ source: "codex", unpricedEvents: 1 }],
      },
      quota: quotaMetricsFromSnapshots([
        {
          provider: "codex",
          windows: [
            {
              id: "codex-primary-window",
              label: "Primary",
              kind: { rolling: { durationSeconds: 18_000 } },
              usedPercent: 50,
              resetAt: 100,
              sourceTimestamp: 50,
            },
          ],
          sourceTimestamp: 50,
        },
      ]),
    });
    await push.forceFlush();

    const [resource] = exporter.getMetrics();
    expect(resource?.resource.attributes).toMatchObject({
      "service.name": "toolkit-history",
      "service.instance.id": "test-mac",
    });

    const tokens = latest(exporter, USAGE_METRIC_NAMES.tokens);
    expect(tokens?.descriptor.name).toBe("ai_usage_tokens_total");
    expect(tokens?.descriptor.unit).toBe("");
    expect(tokens?.dataPointType).toBe(DataPointType.SUM);
    expect(
      tokens?.dataPointType === DataPointType.SUM && tokens.isMonotonic,
    ).toBe(true);
    expect(points(tokens)).toEqual([
      {
        attributes: { source: "claude", model: "opus", type: "input" },
        value: 1200,
      },
      {
        attributes: { source: "claude", model: "opus", type: "output" },
        value: 300,
      },
    ]);
    expect(points(latest(exporter, "ai_usage_cost_usd_total"))).toEqual([
      { attributes: { source: "claude", model: "opus" }, value: 2.5 },
    ]);
    expect(points(latest(exporter, "ai_usage_events_total"))).toEqual([
      { attributes: { source: "claude", model: "opus" }, value: 4 },
    ]);
    expect(points(latest(exporter, "ai_usage_unpriced_events_total"))).toEqual([
      { attributes: { source: "codex" }, value: 1 },
    ]);
    expect(
      points(latest(exporter, "ai_subscription_quota_used_ratio")),
    ).toEqual([
      {
        attributes: {
          provider: "codex",
          window_id: "codex-primary-window",
          window_kind: "rolling",
        },
        value: 0.5,
      },
    ]);
    expect(
      points(latest(exporter, "ai_subscription_quota_reset_timestamp_seconds")),
    ).toEqual([
      {
        attributes: { provider: "codex", window_id: "codex-primary-window" },
        value: unix(100),
      },
    ]);
    expect(
      points(latest(exporter, "ai_subscription_snapshot_timestamp_seconds")),
    ).toEqual([{ attributes: { provider: "codex" }, value: unix(50) }]);
    await push.shutdown();
  });
});

const EMPTY_READER: UsageEventReader = {
  usageFingerprints: () => [],
  usageEventsForDocument: () => [],
};

describe("daemon usage metrics export", () => {
  test("logs a missing Brim cache once and exports no quota", async () => {
    const directory = await tempDir();
    const logged: string[] = [];
    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const metrics = await startUsageMetricsExport({
      ledgerPath: path.join(directory, "usage-export.sqlite"),
      snapshotsPath: path.join(directory, "missing.json"),
      exporter,
      hostname: "test-mac",
      exportIntervalMillis: 3_600_000,
      log: (message) => {
        logged.push(message);
        return Promise.resolve();
      },
    });
    await metrics.refresh(EMPTY_READER, new Date());
    await metrics.refresh(EMPTY_READER, new Date());
    expect(logged).toEqual([
      "Brim snapshot cache not found; skipping quota metrics",
    ]);
    await metrics.shutdown();
    expect(
      exported(exporter).filter((metric) => metric.dataPoints.length > 0),
    ).toEqual([]);
  });

  test("a corrupt Brim cache throws and clears quota gauges", async () => {
    const directory = await tempDir();
    const snapshotsPath = path.join(directory, "snapshots.json");
    await writeFile(snapshotsPath, await Bun.file(FIXTURE).text());
    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const metrics = await startUsageMetricsExport({
      ledgerPath: path.join(directory, "usage-export.sqlite"),
      snapshotsPath,
      exporter,
      hostname: "test-mac",
      exportIntervalMillis: 3_600_000,
      log: () => Promise.resolve(),
    });
    await metrics.refresh(EMPTY_READER, new Date());
    await writeFile(snapshotsPath, "[{]");
    await expect(metrics.refresh(EMPTY_READER, new Date())).rejects.toThrow(
      /not valid JSON/,
    );
    await metrics.shutdown();
    expect(
      points(latest(exporter, "ai_subscription_quota_used_ratio")),
    ).toEqual([]);
  });

  test("logs the first export failure of a streak", async () => {
    const directory = await tempDir();
    const logged: string[] = [];
    const failing: PushMetricExporter = {
      export: (_metrics, resultCallback) => {
        resultCallback({ code: 1, error: new Error("connection refused") });
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
    const metrics = await startUsageMetricsExport({
      ledgerPath: path.join(directory, "usage-export.sqlite"),
      snapshotsPath: FIXTURE,
      exporter: failing,
      hostname: "test-mac",
      exportIntervalMillis: 3_600_000,
      log: (message) => {
        logged.push(message);
        return Promise.resolve();
      },
    });
    await metrics.refresh(EMPTY_READER, new Date());
    // The final flush exports into the failing exporter; the SDK reports the
    // failure only through the result callback, which is what gets logged.
    await metrics.shutdown();
    expect(logged).toEqual(["usage metrics export failed"]);
  });
});
