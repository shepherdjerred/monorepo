import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { exportDashboardWithHelmEscaping } from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-export.ts";
import {
  addCiCapacityHealthPanels,
  addCiIoPanels,
} from "./ci-capacity-panels.ts";

/**
 * CI capacity and admission.
 *
 * Successor to the Buildkite dashboard, reduced to the half that survived the
 * provider swap. Kueue still admits CI work against the node's CPU, memory and
 * ephemeral-storage quotas, so its queue depth and admission latency remain
 * worth charting.
 *
 * The I/O panels came back with it, re-pointed at the `woodpecker:` recording
 * rules. The agent-health panels did not: they read the Buildkite agent
 * stack's own metrics, which have no Woodpecker counterpart.
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
  addCiIoPanels(builder);

  return builder.build();
}

export function exportCiCapacityDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createCiCapacityDashboard());
}
