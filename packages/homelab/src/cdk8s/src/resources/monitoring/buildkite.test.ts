import { describe, expect, it } from "bun:test";
import { Testing } from "cdk8s";
import { z } from "zod";
import { MAINTENANCE_IMAGE_READY } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/maintenance-image-readiness.ts";
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

function normalizePromql(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function synthBuildkiteMonitoring(): unknown[] {
  const chart = Testing.chart();
  createBuildkiteMonitoring(chart);
  return z.array(z.unknown()).parse(Testing.synth(chart));
}

function expectExpressionContains(
  expression: string,
  fragments: readonly string[],
): void {
  const normalizedExpression = normalizePromql(expression);
  for (const fragment of fragments) {
    expect(normalizedExpression).toContain(normalizePromql(fragment));
  }
}

function assertCollectorStaleExpression(rule: Record<string, unknown>): void {
  const expression = String(rule["expr"]);
  expectExpressionContains(expression, ["> 1200"]);
  if (MAINTENANCE_IMAGE_READY) {
    expectExpressionContains(expression, [
      `job="${BUILDKITE_BUN_CACHE_GC_ACTIVITY}"`,
      "kubernetes_maintenance_last_success_timestamp_seconds",
      `absent(\n    kubernetes_maintenance_last_success_timestamp_seconds{\n      job="${BUILDKITE_BUN_CACHE_GC_ACTIVITY}"\n    }\n  )`,
      'temporal_worker_app_process_start_time_seconds{\n        namespace="buildkite",\n        pod=~"temporal-maintenance-worker-.*"\n      }',
      'kube_pod_start_time{\n        namespace="buildkite",\n        pod=~"temporal-maintenance-worker-.*"\n      }',
      'kube_deployment_status_replicas_available{\n        namespace="buildkite",\n        deployment="temporal-maintenance-worker"\n      }',
      'up{\n        namespace="buildkite",\n        service="temporal-maintenance-worker-app-metrics"\n      }',
      'condition="Progressing",\n        status="false"',
      'reason="NewReplicaSetAvailable"',
    ]);
    return;
  }
  expectExpressionContains(expression, [
    "kube_cronjob_status_last_successful_time",
    "kube_cronjob_created",
  ]);
}

function requireAlert(
  rules: readonly Record<string, unknown>[],
  alertName: string,
): Record<string, unknown> {
  const alert = rules.find((rule) => rule["alert"] === alertName);
  if (alert === undefined) {
    throw new Error(`Missing Buildkite alert: ${alertName}`);
  }
  return alert;
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
    const bunCacheWarning = requireAlert(
      alertGroup.rules,
      "BuildkiteBunCacheUsageHigh",
    );
    const bunCacheCritical = requireAlert(
      alertGroup.rules,
      "BuildkiteBunCacheUsageCritical",
    );
    const collectorStale = requireAlert(
      alertGroup.rules,
      "BuildkiteBunCacheCollectorStale",
    );

    expect(bunCacheWarning).toMatchObject({
      for: "10m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "buildkite",
      },
    });
    expect(String(bunCacheWarning["expr"])).toContain(
      `persistentvolumeclaim="${BUILDKITE_BUN_CACHE_PVC}"`,
    );
    expect(String(bunCacheWarning["expr"])).toContain("> 0.75");
    expect(String(bunCacheWarning["expr"])).toContain("zfs_dataset_used_bytes");
    expect(String(bunCacheWarning["expr"])).toContain(
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
    expect(String(bunCacheCritical["expr"])).toContain("> 0.9");

    expect(collectorStale).toMatchObject({
      for: "1m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "buildkite",
      },
    });
    assertCollectorStaleExpression(collectorStale);
  });
});
