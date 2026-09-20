import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { exportDashboardWithHelmEscaping } from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-export.ts";
import { addCiCapacityHealthPanels } from "./ci-capacity-panels.ts";

/**
 * CI capacity and admission.
 *
 * Successor to the Buildkite dashboard, reduced to the half that survived the
 * provider swap. Kueue still admits CI work against the node's CPU, memory and
 * ephemeral-storage quotas, so its queue depth and admission latency remain
 * worth charting.
 *
 * The agent-health and per-job I/O attribution panels are NOT here. Those read
 * Buildkite's own metrics and its per-job pod labels, and rebuilding them
 * against Woodpecker's labels needs the new CI to have produced data first.
 */
export function createCiCapacityDashboard() {
  const builder = new dashboard.DashboardBuilder("CI — Capacity & Admission")
    .uid("ci-capacity-dashboard")
    .tags(["ci", "kueue", "capacity"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  addCiCapacityHealthPanels(builder);

  return builder.build();
}

export function exportCiCapacityDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createCiCapacityDashboard());
}
