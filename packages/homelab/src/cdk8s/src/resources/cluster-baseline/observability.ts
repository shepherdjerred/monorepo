import type { Chart } from "cdk8s";
import type { DaemonSet } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { createPrometheusMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/prometheus.ts";
import { createSmartctlMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/smartctl.ts";
import { createNvmeMetricsMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/nvme-metrics.ts";
import { createZfsSnapshotsMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/zfs-snapshots.ts";
import { createZfsZpoolMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/zfs-zpool.ts";
import { createKubernetesEventExporter } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/kubernetes-event-exporter.ts";
import { createAllGrafanaDashboards } from "@shepherdjerred/homelab/cdk8s/src/resources/grafana/index.ts";
import { createLokiAlertRules } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/loki.ts";
import { createMonitoringAuthGatewayConfigs } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import { createKueueMetricsServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/kueue.ts";

/**
 * The PrometheusRules, Pod/ServiceMonitors and node exporters the Prometheus
 * Application renders beside its Helm values, in the root chart's order.
 */
export async function createPrometheusExporters(chart: Chart): Promise<void> {
  createPrometheusMonitoring(chart);
  const { smartctlDaemonSet } = await createSmartctlMonitoring(chart);
  const { nvmeMetricsDaemonSet } = await createNvmeMetricsMonitoring(chart);
  const { zfsSnapshotsDaemonSet } = await createZfsSnapshotsMonitoring(chart);
  const { zfsZpoolDaemonSet } = await createZfsZpoolMonitoring(chart);
  createKubernetesEventExporter(chart);
  createTextfileCollectorPolicies(chart, [
    smartctlDaemonSet,
    nvmeMetricsDaemonSet,
    zfsSnapshotsDaemonSet,
    zfsZpoolDaemonSet,
  ]);
}

/**
 * The textfile collectors write `.prom` files to a host directory that
 * node-exporter reads, so nothing connects to them. Each installs its tools
 * at start (`apk add`, `pip install`) from the Alpine and PyPI mirrors over
 * HTTPS.
 */
function createTextfileCollectorPolicies(
  chart: Chart,
  collectors: readonly DaemonSet[],
): void {
  for (const collector of collectors) {
    const name = `${collector.name}-netpol`;
    new KubeNetworkPolicy(chart, name, {
      metadata: { name, namespace: "prometheus" },
      spec: {
        podSelector: { matchLabels: collector.matchLabels },
        policyTypes: ["Egress"],
        egress: [dnsEgressRule(), externalHttpsEgressRule()],
      },
    });
  }
}

/**
 * Cluster observability baseline: alert rules, monitors, exporters, the
 * gateway Caddyfiles, Loki's ruler ConfigMap and every Grafana dashboard.
 */
export async function createClusterObservability(chart: Chart): Promise<void> {
  createMonitoringAuthGatewayConfigs(chart);
  await createPrometheusExporters(chart);
  createKueueMetricsServiceMonitor(chart);
  createLokiAlertRules(chart);
  createAllGrafanaDashboards(chart);
}
