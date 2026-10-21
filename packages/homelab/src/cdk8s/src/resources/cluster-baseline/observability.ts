import type { Chart } from "cdk8s";
import { createPrometheusMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/prometheus.ts";
import { createSmartctlMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/smartctl.ts";
import { createNvmeMetricsMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/nvme-metrics.ts";
import { createZfsSnapshotsMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/zfs-snapshots.ts";
import { createZfsZpoolMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/zfs-zpool.ts";
import { createR2ExporterMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/r2-exporter.ts";
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
  await createSmartctlMonitoring(chart);
  await createNvmeMetricsMonitoring(chart);
  await createZfsSnapshotsMonitoring(chart);
  await createZfsZpoolMonitoring(chart);
  await createR2ExporterMonitoring(chart);
  createKubernetesEventExporter(chart);
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
