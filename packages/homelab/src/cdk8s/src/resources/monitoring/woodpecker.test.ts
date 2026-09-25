import { describe, expect, it } from "vitest";
import { Testing } from "cdk8s";
import { z } from "zod";
import {
  CI_METRICS_SCRAPE_INTERVAL,
  createWoodpeckerMonitoring,
} from "./woodpecker.ts";
import {
  CI_BUN_CACHE_GC_ACTIVITY,
  CI_BUN_CACHE_PVC,
  TURBO_CACHE_CLEAN_ACTIVITY,
} from "./monitoring/rules/woodpecker.ts";

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
          z
            .object({
              port: z.string(),
              path: z.string(),
              interval: z.string(),
              bearerTokenSecret: z.object({
                name: z.string(),
                key: z.string(),
              }),
            })
            .loose(),
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

function synthWoodpeckerMonitoring(): unknown[] {
  const chart = Testing.chart();
  createWoodpeckerMonitoring(chart);
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
  const expression = ruleExpression(rule);
  expectExpressionContains(expression, ["> 1200"]);
  expectExpressionContains(expression, [
    `maintenance_job="${CI_BUN_CACHE_GC_ACTIVITY}"`,
    "kubernetes_maintenance_last_success_timestamp_seconds",
    `absent(\n    kubernetes_maintenance_last_success_timestamp_seconds{\n      maintenance_job="${CI_BUN_CACHE_GC_ACTIVITY}"\n    }\n  )`,
    'temporal_worker_app_process_start_time_seconds{\n        namespace="woodpecker-ci",\n        pod=~"temporal-maintenance-worker-.*"\n      }',
    'kube_pod_start_time{\n        namespace="woodpecker-ci",\n        pod=~"temporal-maintenance-worker-.*"\n      }',
    'kube_deployment_status_replicas_available{\n        namespace="woodpecker-ci",\n        deployment="temporal-maintenance-worker"\n      }',
    'up{\n        namespace="woodpecker-ci",\n        service="temporal-maintenance-worker-app-metrics"\n      }',
    'condition="Progressing",\n        status="false"',
    'reason="NewReplicaSetAvailable"',
  ]);
}

function ruleExpression(rule: Record<string, unknown>): string {
  return z.string().parse(rule["expr"]);
}

function requireAlert(
  rules: readonly Record<string, unknown>[],
  alertName: string,
): Record<string, unknown> {
  const alert = rules.find((rule) => rule["alert"] === alertName);
  if (alert === undefined) {
    throw new Error(`Missing Woodpecker alert: ${alertName}`);
  }
  return alert;
}

describe("Woodpecker monitoring manifests", () => {
  it("synthesizes a selectable 10-second authenticated server PodMonitor", () => {
    const manifests = synthWoodpeckerMonitoring();
    const manifest = manifests.find(
      (candidate) => PodMonitorSchema.safeParse(candidate).success,
    );
    const podMonitor = PodMonitorSchema.parse(manifest);

    expect(podMonitor.metadata).toEqual({
      name: "woodpecker-server",
      namespace: "woodpecker",
      labels: { release: "prometheus" },
    });
    expect(podMonitor.spec.namespaceSelector.matchNames).toEqual([
      "woodpecker",
    ]);
    expect(podMonitor.spec.selector.matchLabels).toEqual({
      app: "woodpecker-server",
    });
    // The bearer token is not optional: without it Woodpecker answers 401 and
    // the scrape silently yields no series.
    expect(podMonitor.spec.podMetricsEndpoints).toEqual([
      {
        port: "http",
        path: "/metrics",
        interval: CI_METRICS_SCRAPE_INTERVAL,
        bearerTokenSecret: {
          name: "woodpecker-server-credentials",
          key: "WOODPECKER_PROMETHEUS_AUTH_TOKEN",
        },
      },
    ]);
  });

  it("does not add a second kube-state-metrics scrape", () => {
    const kinds = synthWoodpeckerMonitoring().flatMap((manifest) => {
      const parsed = ResourceKindSchema.safeParse(manifest);
      return parsed.success ? [parsed.data.kind] : [];
    });

    expect(kinds).not.toContain("ServiceMonitor");
  });

  it("synthesizes selected recording and alert groups in Woodpecker", () => {
    const manifests = synthWoodpeckerMonitoring();
    const manifest = manifests.find(
      (candidate) => PrometheusRuleSchema.safeParse(candidate).success,
    );
    const prometheusRule = PrometheusRuleSchema.parse(manifest);

    expect(prometheusRule.metadata).toEqual({
      name: "prometheus-woodpecker-rules",
      namespace: "woodpecker",
      labels: { release: "prometheus" },
    });
    expect(prometheusRule.spec.groups.map((group) => group.name)).toEqual([
      "woodpecker-ci-io-recording",
      "woodpecker-ci-io-rollups",
      "woodpecker-ci-io-alerts",
    ]);
    expect(prometheusRule.spec.groups.map((group) => group.interval)).toEqual([
      "10s",
      "5m",
      "30s",
    ]);

    const alertGroup = prometheusRule.spec.groups.find(
      (group) => group.name === "woodpecker-ci-io-alerts",
    );
    if (alertGroup === undefined) {
      throw new Error("Missing Woodpecker alert group");
    }
    const bunCacheWarning = requireAlert(
      alertGroup.rules,
      "WoodpeckerBunCacheUsageHigh",
    );
    const bunCacheCritical = requireAlert(
      alertGroup.rules,
      "WoodpeckerBunCacheUsageCritical",
    );
    const collectorStale = requireAlert(
      alertGroup.rules,
      "WoodpeckerBunCacheCollectorStale",
    );
    const turboCleanupStale = requireAlert(
      alertGroup.rules,
      "TurboCacheCleanupStale",
    );
    const bunCacheWarningExpr = ruleExpression(bunCacheWarning);
    const bunCacheCriticalExpr = ruleExpression(bunCacheCritical);

    expect(bunCacheWarning).toMatchObject({
      for: "10m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "woodpecker-ci",
      },
    });
    expect(bunCacheWarningExpr).toContain(
      `persistentvolumeclaim="${CI_BUN_CACHE_PVC}"`,
    );
    expect(bunCacheWarningExpr).toContain("> 0.75");
    expect(bunCacheWarningExpr).toContain("zfs_dataset_used_bytes");
    expect(bunCacheWarningExpr).toContain("kube_persistentvolumeclaim_info");

    expect(bunCacheCritical).toMatchObject({
      for: "5m",
      labels: {
        severity: "critical",
        category: "ci",
        namespace: "woodpecker-ci",
      },
    });
    expect(bunCacheCriticalExpr).toContain("> 0.9");

    expect(collectorStale).toMatchObject({
      for: "1m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "woodpecker-ci",
      },
    });
    assertCollectorStaleExpression(collectorStale);

    expect(turboCleanupStale).toMatchObject({
      for: "1m",
      labels: {
        severity: "warning",
        category: "ci",
        namespace: "turbo-cache",
      },
    });
    const turboExpression = ruleExpression(turboCleanupStale);
    expectExpressionContains(turboExpression, [
      `maintenance_job="${TURBO_CACHE_CLEAN_ACTIVITY}"`,
      "> 129600",
      "kubernetes_maintenance_last_success_timestamp_seconds",
    ]);
    expect(turboExpression).not.toMatch(/[{,]\s*job=/);
  });
});
