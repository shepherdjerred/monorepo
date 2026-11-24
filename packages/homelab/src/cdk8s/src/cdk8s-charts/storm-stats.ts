import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { ConfigMap, Namespace } from "cdk8s-plus-31";
import {
  STORM_STATS_ACTIVE,
  createStormStatsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/storm-stats/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createStormStatsChart(app: App, active = STORM_STATS_ACTIVE) {
  const chart = new Chart(app, "storm-stats", {
    namespace: "storm-stats",
    disableResourceNameHashes: true,
  });
  if (!active) {
    new ConfigMap(chart, "activation", { data: { active: "false" } });
    return chart;
  }
  new Namespace(chart, "storm-stats-namespace", {
    metadata: { name: "storm-stats" },
  });
  createStormStatsDeployment(chart);
  return chart;
}
