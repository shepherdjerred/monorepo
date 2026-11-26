import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  CHARTS_ACTIVE,
  createChartsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/charts/index.ts";

/**
 * Retained inactive wrapper shell for `chart:charts`: `charts` deploys from
 * `charts-bootstrap` on Docker Hub OCI so recovery never depends on `charts`.
 */
export function createChartsChart(app: App, active = false) {
  const chart = new Chart(app, "charts", {
    namespace: "charts",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "charts-namespace", { metadata: { name: "charts" } });
  createChartsDeployment(chart);
  return chart;
}

/** Active OCI self-bootstrap chart deployed by the `charts` Application. */
export function createChartsBootstrapChart(app: App, active = CHARTS_ACTIVE) {
  const chart = new Chart(app, "charts-bootstrap", {
    namespace: "charts",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "charts-namespace", { metadata: { name: "charts" } });
  createChartsDeployment(chart);
  return chart;
}
