import type { Chart } from "cdk8s";
import { EnvValue, Protocol } from "cdk8s-plus-31";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";

/**
 * The Temporal SDK's own Prometheus exporter, on the roles that run embedded
 * Workers (`application` and `activity-worker`; `gateway` runs none).
 *
 * Those Workers run every unversioned Scout Workflow and Activity, so their
 * per-attempt Workflow Task failure counters are the only signal for a Task
 * that keeps failing: the server's `failed_workflow_tasks` records it once.
 * The port matches the versioned workflow-worker pods' exporter.
 */
export const SCOUT_TEMPORAL_METRICS_PORT = 9464;
const PORT_NAME = "temporal-metrics";

export const scoutTemporalMetricsEnv: Record<string, EnvValue> = {
  TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue(
    `0.0.0.0:${SCOUT_TEMPORAL_METRICS_PORT.toString()}`,
  ),
};

export const scoutTemporalMetricsContainerPort = {
  name: PORT_NAME,
  number: SCOUT_TEMPORAL_METRICS_PORT,
  protocol: Protocol.TCP,
};

export const scoutTemporalMetricsServicePort = {
  name: PORT_NAME,
  port: SCOUT_TEMPORAL_METRICS_PORT,
};

/** Scrape the exporter through the role's existing metrics Service. */
export function createScoutTemporalMetricsServiceMonitor(
  chart: Chart,
  name: string,
  matchLabels: Record<string, string>,
): void {
  createServiceMonitor(chart, {
    name,
    port: PORT_NAME,
    matchLabels,
  });
}
