import { Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const scoutWorkflowRoutingKnown = new Gauge({
  name: "scout_temporal_workflow_routing_known",
  help: "Whether the current scrape obtained valid Worker Deployment routing",
  registers: [registry],
});
export const scoutWorkflowRoutingTimestamp = new Gauge({
  name: "scout_temporal_workflow_routing_timestamp_seconds",
  help: "Timestamp of the last successful Worker Deployment routing read",
  registers: [registry],
});
export const scoutWorkflowRoutedVersion = new Gauge({
  name: "scout_temporal_workflow_routed_version",
  help: "Required current (100) and nonzero ramp traffic percentage by routed build",
  labelNames: [
    "temporal_namespace",
    "worker_deployment_name",
    "worker_build_id",
    "routing",
  ] as const,
  registers: [registry],
});
