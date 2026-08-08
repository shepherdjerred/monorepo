import { describe, expect, it } from "bun:test";
import { Testing } from "cdk8s";
import { z } from "zod";
import {
  BUILDKITE_CONTROLLER_METRICS_INTERVAL,
  createBuildkiteMonitoring,
} from "./buildkite.ts";
import {
  BUILDKITE_BUN_CACHE_GC_ACTIVITY,
  BUILDKITE_BUN_CACHE_PVC,
} from "./monitoring/rules/buildkite.ts";

const MetadataSchema = z
  .object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string(), z.string()),
  })
  .loose();

const PodMonitorSchema = z
  .object({
    apiVersion: z.literal("monitoring.coreos.com/v1"),
    kind: z.literal("PodMonitor"),
    metadata: MetadataSchema,
    spec: z
      .object({
        namespaceSelector: z.object({
          matchNames: z.array(z.string()),
        }),
        selector: z.object({
          matchLabels: z.record(z.string(), z.string()),
        }),
        podMetricsEndpoints: z.array(
          z.object({
            port: z.string(),
            path: z.string(),
            interval: z.string(),
          }),
        ),
      })
      .loose(),
  })
  .loose();

const ResourceKindSchema = z
  .object({
    kind: z.string(),
  })
  .loose();

const PrometheusRuleSchema = z
  .object({
    apiVersion: z.literal("monitoring.coreos.com/v1"),
    kind: z.literal("PrometheusRule"),
    metadata: MetadataSchema,
    spec: z.object({
      groups: z.array(
        z.object({
          name: z.string(),
          interval: z.string(),
          rules: z.array(z.record(z.string(), z.unknown())),
        }),
      ),
    }),
  })
  .loose();

function synthBuildkiteMonitoring(): unknown[] {
  const chart = Testing.chart();
  createBuildkiteMonitoring(chart);
  return z.array(z.unknown()).parse(Testing.synth(chart));
}

describe("Buildkite monitoring manifests", () => {
  it("synthesizes a selectable 10-second controller PodMonitor", () => {
    const manifests = synthBuildkiteMonitoring();
    const manifest = manifests.find(
      (candidate) => PodMonitorSchema.safeParse(candidate).success,
    );
    const podMonitor = PodMonitorSchema.parse(manifest);

    expect(podMonitor.metadata).toEqual({
      name: "buildkite-controller",
      namespace: "buildkite",
      labels: { release: "prometheus" },
    });
    expect(podMonitor.spec.namespaceSelector.matchNames).toEqual(["buildkite"]);
    expect(podMonitor.spec.selector.matchLabels).toEqual({
      app: "buildkite-agent-stack-k8s",
    });
    expect(podMonitor.spec.podMetricsEndpoints).toEqual([
      {
        port: "metrics",
        path: "/metrics",
        interval: BUILDKITE_CONTROLLER_METRICS_INTERVAL,
      },
    ]);
  });

  it("does not add a second kube-state-metrics scrape", () => {
    const kinds = synthBuildkiteMonitoring().flatMap((manifest) => {
      const parsed = ResourceKindSchema.safeParse(manifest);
      return parsed.success ? [parsed.data.kind] : [];
    });

    expect(kinds).not.toContain("ServiceMonitor");
  });

  it("synthesizes selected recording and alert groups in Buildkite", () => {
    const manifests = synthBuildkiteMonitoring();
    const manifest = manifests.find(
      (candidate) => PrometheusRuleSchema.safeParse(candidate).success,
    );
    const prometheusRule = PrometheusRuleSchema.parse(manifest);

    expect(prometheusRule.metadata).toEqual({
      name: "prometheus-buildkite-rules",
      namespace: "buildkite",
      labels: { release: "prometheus" },
    });
    expect(prometheusRule.spec.groups.map((group) => group.name)).toEqual([
      "buildkite-ci-io-recording",
      "buildkite-ci-io-rollups",
      "buildkite-ci-io-alerts",
    ]);
    expect(prometheusRule.spec.groups.map((group) => group.interval)).toEqual([
      "10s",
      "5m",
      "30s",
    ]);

    const alertGroup = prometheusRule.spec.groups.find(
      (group) => group.name === "buildkite-ci-io-alerts",
    );
    if (alertGroup === undefined) {
      throw new Error("Missing Buildkite alert group");
    }
    const alerts = alertGroup.rules.flatMap((rule) => {
      const alert = rule["alert"];
      return typeof alert === "string" ? [rule] : [];
    });
    const bunCacheWarning = alerts.find(
      (rule) => rule["alert"] === "BuildkiteBunCacheUsageHigh",
    );
    const bunCacheCritical = alerts.find(
      (rule) => rule["alert"] === "BuildkiteBunCacheUsageCritical",
    );
    const collectorStale = alerts.find(
      (rule) => rule["alert"] === "BuildkiteBunCacheCollectorStale",
    );

    expect(bunCacheWarning).toMatchObject({
      for: "10m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "buildkite",
      },
    });
    expect(String(bunCacheWarning?.["expr"])).toContain(
      `persistentvolumeclaim="${BUILDKITE_BUN_CACHE_PVC}"`,
    );
    expect(String(bunCacheWarning?.["expr"])).toContain("> 0.75");
    expect(String(bunCacheWarning?.["expr"])).toContain(
      "zfs_dataset_used_bytes",
    );
    expect(String(bunCacheWarning?.["expr"])).toContain(
      "kube_persistentvolumeclaim_info",
    );

    expect(bunCacheCritical).toMatchObject({
      for: "5m",
      labels: {
        severity: "critical",
        category: "ci",
        namespace: "buildkite",
      },
    });
    expect(String(bunCacheCritical?.["expr"])).toContain("> 0.9");

    expect(collectorStale).toMatchObject({
      for: "1m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "buildkite",
      },
    });
    expect(String(collectorStale?.["expr"])).toContain(
      `job="${BUILDKITE_BUN_CACHE_GC_ACTIVITY}"`,
    );
    expect(String(collectorStale?.["expr"])).toContain(
      "kubernetes_maintenance_last_success_timestamp_seconds",
    );
    expect(String(collectorStale?.["expr"])).toContain("> 1200");
    expect(String(collectorStale?.["expr"])).toContain(
      `absent(\n  kubernetes_maintenance_last_success_timestamp_seconds{\n    job="${BUILDKITE_BUN_CACHE_GC_ACTIVITY}"\n  }\n)`,
    );
  });
});
