import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { exportDashboardWithHelmEscaping } from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-export.ts";
import {
  addCiCapacityHealthPanels,
  addCiIoPanels,
} from "./ci-capacity-panels.ts";

/**
 * CI capacity and admission.
 *
 * Kueue admits CI work against the node's CPU, memory and ephemeral-storage
 * quotas, so its queue depth and admission latency are worth charting. The
 * I/O panels read the `woodpecker:` recording rules.
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
