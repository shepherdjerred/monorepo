import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  CHARTS_ACTIVE,
  createChartsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/charts/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createChartsChart(app: App, active = CHARTS_ACTIVE) {
  const chart = new Chart(app, "charts", {
    namespace: "charts",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "charts-namespace", { metadata: { name: "charts" } });
  createChartsDeployment(chart);
  return chart;
}
